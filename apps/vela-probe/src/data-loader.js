import { asBytes, checkRange, createProbeTask } from './probe-io'

export function validateDataManifest(assets) {
  if (!assets || assets.magic !== 'JSPEAK_RAW_DATA' || assets.schemaVersion !== 1 ||
      assets.scope !== 'en-us-candidate-probe' || assets.sampleRate !== 22050 || assets.pageBytes !== 32768 ||
      !/^[0-9a-f]{40}$/.test(assets.upstreamCommit) || !/^[0-9a-f]{64}$/.test(assets.dataFingerprint) ||
      !Array.isArray(assets.files) || !assets.files.length || assets.files.length > 64) throw new Error('incompatible data manifest');
  var spec = assets.hash32Spec;
  if (!spec || spec.name !== 'xorshift32-byte-mix' || spec.seed !== 0 || spec.result !== 'signed-int32' ||
      spec.reset !== 'seed 0 separately for each file, page, and window' ||
      !Array.isArray(spec.steps) || spec.steps.join('|') !== 'state ^= byte|state ^= state << 13|state ^= state >>> 17|state ^= state << 5') {
    throw new Error('incompatible hash32 contract');
  }
  function checksum(value) { if (value !== (value | 0)) throw new Error('invalid signed hash32'); }
  var ids = {};
  var uris = {};
  var total = 0;
  for (var i = 0; i < assets.files.length; i++) {
    var item = assets.files[i];
    if (!item || typeof item.id !== 'string' || !item.id.length || ids['$' + item.id] ||
        typeof item.uri !== 'string' || item.uri.indexOf('/common/espeak/') !== 0 ||
        item.uri.indexOf('..') !== -1 || !/\.txt$/.test(item.uri) || uris['$' + item.uri]) throw new Error('duplicate or invalid manifest identity');
    ids['$' + item.id] = true; uris['$' + item.uri] = true;
    checkRange(item.byteLength, 0, item.byteLength);
    if (!item.byteLength) throw new Error('empty candidate file');
    checksum(item.hash32); total += item.byteLength;
    if (!Array.isArray(item.pages) || !Array.isArray(item.windows) || item.windows.length > 32) throw new Error('invalid manifest ranges');
    var offset = 0;
    for (var j = 0; j < item.pages.length; j++) {
      var page = item.pages[j];
      checkRange(item.byteLength, page.position, page.length);
      if (page.position !== offset || page.length !== Math.min(32768, item.byteLength - offset) || !page.length) throw new Error('invalid manifest page coverage');
      checksum(page.hash32); offset += page.length;
    }
    if (offset !== item.byteLength) throw new Error('incomplete manifest page coverage');
    var windows = {};
    for (var k = 0; k < item.windows.length; k++) {
      var range = item.windows[k];
      checkRange(item.byteLength, range.position, range.length);
      if (typeof range.id !== 'string' || !range.id.length || windows['$' + range.id] ||
          (!range.length && range.position !== item.byteLength)) throw new Error('invalid manifest window');
      windows['$' + range.id] = true; checksum(range.hash32);
    }
  }
  if (total !== assets.totalDataBytes || total > 2097152) throw new Error('candidate size mismatch or >2MiB cap');
  return true;
}

// Diagnostic adapter only: no dictionary parsing and no successful-device claim.
// Retained bytes count application-owned backing stores, never the JS heap.
export function createDataProbe(file, assets, mode, callbacks, environment) {
  var task = createProbeTask(file, { error: fatal, idle: release }, environment);
  var started = 0;
  var startedOnce = false;
  var retained = [];
  var retainedBytes = 0;
  var currentBytes = 0;
  var assembledBytes = 0;
  var peakBytes = 0;
  var ioMs = 0;
  var hashMs = 0;
  var copyMs = 0;
  var maxBlockMs = 0;
  var failures = 0;
  var activeRow = null;
  function release() { retained = []; retainedBytes = 0; currentBytes = 0; assembledBytes = 0; }
  function live() { peakBytes = Math.max(peakBytes, retainedBytes + currentBytes + assembledBytes); }
  function metrics() {
    return 'io=' + ioMs + 'ms hash=' + hashMs + 'ms assemble=' + copyMs + 'ms total=' +
      (task.now() - started) + 'ms maxHashCopy=' + maxBlockMs + 'ms livePeak=' + peakBytes + 'B; heap不可测';
  }
  function fatal(message) {
    failures++;
    if (activeRow) callbacks.row(activeRow, 'FAIL ' + message);
    release(); callbacks.error(message + '; ' + metrics());
  }
  function result(label, value) {
    if (value.indexOf('RUNNING') === 0) activeRow = label;
    callbacks.row(label, value);
  }
  function read(descriptor, range, done) {
    var args = { uri: descriptor.uri };
    if (range) {
      checkRange(descriptor.byteLength, range.position, range.length);
      args.position = range.position; args.length = range.length;
    }
    var length = range ? range.length : descriptor.byteLength;
    var expected = range ? range.hash32 : descriptor.hash32;
    task.call('readArrayBuffer', args, function (data, code, elapsed) {
      ioMs += elapsed;
      var bytes;
      try { bytes = asBytes(data); } catch (error) { done(String(error)); return; }
      currentBytes = bytes.buffer.byteLength; live();
      if (bytes.length !== length) { currentBytes = 0; done('length=' + bytes.length + ' expected=' + length); return; }
      task.hash(bytes, 0, function (hash, duration, maximum) {
        hashMs += duration; maxBlockMs = Math.max(maxBlockMs, maximum);
        if (hash !== expected) { currentBytes = 0; done('hash32=' + hash + ' expected=' + expected); return; }
        done(null, bytes, hash);
      });
    }, function (data, code, elapsed) { ioMs += elapsed; done(String(code) + ' ' + String(data)); });
  }
  function finish() {
    result('D1 ' + mode + ' 计量', metrics());
    var held = retainedBytes;
    release();
    callbacks.done((failures ? 'FAIL ' + failures + '项' : 'PASS') + '; verifiedResident=' + held + 'B; buffers released');
  }
  function whole(files, index) {
    if (index === files.length) { finish(); return; }
    var item = files[index];
    var label = 'D1 ' + mode + ' ' + item.id;
    var time = task.now();
    var beforeIO = ioMs;
    var beforeHash = hashMs;
    result(label, 'RUNNING len=' + item.byteLength);
    read(item, null, function (error, bytes, hash) {
      if (error) { failures++; result(label, 'FAIL ' + error); }
      else {
        result(label, 'PASS len=' + bytes.length + ' hash32=' + hash + '; io=' + (ioMs - beforeIO) +
          'ms hash=' + (hashMs - beforeHash) + 'ms total=' + (task.now() - time) + 'ms');
        if (mode === 'resident') { retained.push(bytes); retainedBytes += bytes.buffer.byteLength; }
      }
      currentBytes = 0;
      task.defer(function () { whole(files, index + 1); });
    });
  }
  function windows(item, index, done) {
    var list = item.windows || [];
    if (index === list.length) {
      // EOF is intentionally a raw API diagnostic, outside normal bounded reads.
      var label = 'D1 ' + item.id + ' EOF';
      result(label, 'RUNNING exact EOF diagnostic');
      task.call('readArrayBuffer', { uri: item.uri, position: item.byteLength, length: 1 }, function (data, code, elapsed) {
        ioMs += elapsed;
        var bytes = asBytes(data);
        if (bytes.length) { failures++; result(label, 'FAIL nonempty len=' + bytes.length); }
        else result(label, 'PASS empty at exact EOF');
        task.defer(done);
      }, function (data, code, elapsed) {
        ioMs += elapsed;
        result(label, 'OBSERVED ' + String(code) + ' ' + String(data) + '; EOF错误不放行读取');
        task.defer(done);
      });
      return;
    }
    var range = list[index];
    if (range.length === 0 && range.position === item.byteLength) {
      // A generated zero-length EOF descriptor is a bounds-check fixture;
      // the raw native EOF request is performed separately above.
      checkRange(item.byteLength, range.position, range.length);
      task.defer(function () { windows(item, index + 1, done); });
      return;
    }
    result('D1 ' + item.id + ' ' + range.id, 'RUNNING pos=' + range.position + ' len=' + range.length);
    read(item, range, function (error, bytes, hash) {
      if (error) failures++;
      result('D1 ' + item.id + ' ' + range.id, error ? 'FAIL ' + error :
        'PASS pos=' + range.position + ' len=' + bytes.length + ' hash32=' + hash);
      currentBytes = 0;
      task.defer(function () { windows(item, index + 1, done); });
    });
  }
  function scan(files, index) {
    if (index === files.length) { finish(); return; }
    var item = files[index];
    var label = 'D1 ' + mode + ' ' + item.id;
    var allocationStart = task.now();
    var buffer = mode === 'assemble' ? new Uint8Array(item.byteLength) : null;
    if (buffer) {
      var allocationMs = task.now() - allocationStart;
      copyMs += allocationMs; maxBlockMs = Math.max(maxBlockMs, allocationMs);
    }
    assembledBytes = buffer ? buffer.length : 0; live();
    var pageIndex = 0;
    var offset = 0;
    result(label, 'RUNNING pages=' + item.pages.length);
    function nextFile() {
      buffer = null; currentBytes = 0; assembledBytes = 0;
      task.defer(function () { scan(files, index + 1); });
    }
    function page() {
      if (pageIndex === item.pages.length) {
        if (offset !== item.byteLength) throw new Error('manifest pages do not cover file');
        if (buffer) {
          task.hash(buffer, 0, function (hash, duration, maximum) {
            hashMs += duration; maxBlockMs = Math.max(maxBlockMs, maximum);
            if (hash !== item.hash32) { failures++; result(label, 'FAIL assembled hash32=' + hash); }
            else { retained.push(buffer); retainedBytes += buffer.length; result(label, 'PASS assembled len=' + buffer.length + ' hash32=' + hash); }
            nextFile();
          });
        } else {
          result(label, 'PASS pages=' + pageIndex + ' verifiedBytes=' + offset);
          windows(item, 0, nextFile);
        }
        return;
      }
      var range = item.pages[pageIndex];
      if (range.position !== offset || range.length < 1 || range.length > 32768) throw new Error('invalid manifest page');
      read(item, range, function (error, bytes) {
        if (error) {
          failures++;
          result(label, 'FAIL page=' + pageIndex + ' pos=' + range.position + ' ' + error);
          currentBytes = 0;
          if (mode === 'scan') windows(item, 0, nextFile); else nextFile();
          return;
        }
        if (buffer) {
          var time = task.now();
          buffer.set(bytes, offset);
          var duration = task.now() - time;
          copyMs += duration; maxBlockMs = Math.max(maxBlockMs, duration);
        }
        offset += bytes.length; pageIndex++; currentBytes = 0;
        task.defer(page);
      });
    }
    page();
  }
  return {
    cancel: task.cancel, isPending: task.isPending,
    start: function () {
      if (startedOnce || task.isCancelled()) return;
      startedOnce = true; started = task.now();
      try {
        validateDataManifest(assets);
        if (['whole', 'scan', 'resident', 'assemble'].indexOf(mode) < 0) throw new Error('unknown D1 mode');
        var total = 0;
        var files = [];
        for (var i = 0; i < assets.files.length; i++) {
          var item = assets.files[i];
          checkRange(item.byteLength, 0, item.byteLength);
          total += item.byteLength;
          if (mode === 'resident' || mode === 'assemble' || item.id === 'en_dict' || item.id === 'phondata') files.push(item);
        }
        if (total !== assets.totalDataBytes || total > 2097152 || !files.length) throw new Error('candidate size mismatch or >2MiB cap');
        result('D1 身份', assets.upstreamCommit.slice(0, 12) + ' data=' + assets.dataFingerprint.slice(0, 16));
        if (mode === 'scan' || mode === 'assemble') scan(files, 0); else whole(files, 0);
      } catch (error) { fatal(String(error)); task.cancel(); }
    }
  };
}
