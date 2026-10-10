import { asBytes, nativeWriteBytes, createProbeTask } from './probe-io'

export function validateOracleWav(bytes, asset) {
  if (bytes.length !== asset.byteLength || bytes.length < 44 || bytes.length > 262144) throw new Error('WAV length outside short-phrase cap');
  var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, false) !== 0x52494646 || view.getUint32(8, false) !== 0x57415645 ||
      view.getUint32(12, false) !== 0x666d7420 || view.getUint32(16, true) !== 16 ||
      view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 ||
      view.getUint32(24, true) !== 22050 || view.getUint32(28, true) !== 44100 ||
      view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16 ||
      view.getUint32(36, false) !== 0x64617461 || view.getUint32(40, true) !== bytes.length - 44 ||
      view.getUint32(4, true) !== bytes.length - 8 || asset.sampleRate !== 22050 ||
      asset.sampleCount * 2 !== bytes.length - 44) throw new Error('unsupported Oracle WAV format; expected canonical PCM16 mono 22050Hz');
  return true;
}

// Bounded diagnostic writer. Modes independently observe append, nonzero
// position, header overwrite, and the short-phrase full-buffer fallback.
// Only ready() authorizes playback; every byte is compared before that event.
export function createWavProbe(file, asset, mode, uri, callbacks, environment) {
  var source = null;
  var owns = false;
  var cleaning = false;
  var started = false;
  var writeCount = 0;
  var startedAt = 0;
  var ioMs = 0;
  var hashMs = 0;
  var maxBlockMs = 0;
  var copyMs = 0;
  var maxCopyMs = 0;
  var task = createProbeTask(file, {
    error: function (message) { callbacks.error(message); },
    idle: cleanup,
    cleanupTimeout: function () { callbacks.cleanup('FAIL delete timeout; leftover: ' + uri); }
  }, environment);
  function cleanup() {
    source = null;
    if (!owns || cleaning || task.isPending()) return;
    cleaning = true;
    task.call('delete', { uri: uri }, function () {
      callbacks.cleanup('PASS removed owned file');
    }, function (data, code) {
      if (Number(code) === 301) callbacks.cleanup('PASS owned file already absent (301)');
      else callbacks.cleanup('FAIL ' + String(code) + ' ' + String(data) + '; leftover: ' + uri);
    }, true);
  }
  function fail(stage, message) {
    callbacks.row(stage, 'FAIL ' + message);
    callbacks.error(stage + ' ' + message);
    task.cancel();
  }
  function readback() {
    task.call('readArrayBuffer', { uri: uri }, function (data, code, elapsed) {
      ioMs += elapsed;
      var actual = asBytes(data);
      if (actual.length !== source.length) { fail('readback', 'len=' + actual.length + ' expected=' + source.length); return; }
      var offset = 0;
      function compare() {
        var time = task.now();
        var end = Math.min(offset + 4096, source.length);
        for (; offset < end; offset++) {
          if (source[offset] !== actual[offset]) { fail('readback', 'byte mismatch offset=' + offset); return; }
        }
        var duration = task.now() - time;
        hashMs += duration; maxBlockMs = Math.max(maxBlockMs, duration);
        if (offset < source.length) { task.defer(compare); return; }
        callbacks.row('readback', 'PASS all ' + actual.length + ' bytes equal; io=' + ioMs + 'ms verify=' + hashMs +
          'ms maxVerify=' + maxBlockMs + 'ms copy=' + copyMs + 'ms maxCopy=' + maxCopyMs +
          'ms total=' + (task.now() - startedAt) + 'ms');
        source = null;
        callbacks.ready(uri);
      }
      task.defer(compare);
    }, function (data, code) { fail('readback', String(code) + ' ' + String(data)); });
  }
  function write(bytes, append, position, label, done) {
    var copyStart = task.now();
    var payload = nativeWriteBytes(bytes);
    var copyDuration = task.now() - copyStart;
    copyMs += copyDuration; maxCopyMs = Math.max(maxCopyMs, copyDuration);
    owns = true;
    var args = { uri: uri, buffer: payload, append: append };
    if (position !== null) args.position = position;
    callbacks.row('write', 'RUNNING ' + label + ' len=' + bytes.length + ' append=' + append + ' pos=' + position);
    task.call('writeArrayBuffer', args, function (data, code, elapsed) {
      ioMs += elapsed; writeCount++;
      callbacks.row('write', 'ACK ' + label + '; writes=' + writeCount + '; len=' + payload.length +
        ' backing=' + payload.buffer.byteLength + ' offset=' + payload.byteOffset);
      task.defer(done);
    }, function (data, code) { fail('write ' + label, String(code) + ' ' + String(data)); });
  }
  function beginWrites() {
    if (mode === 'buffered') { write(source, false, 0, 'bounded full WAV', readback); return; }
    var header = new Uint8Array(44);
    header.set(source.subarray(0, 44));
    var view = new DataView(header.buffer);
    view.setUint32(4, 36, true); view.setUint32(40, 0, true);
    var offset = 44;
    function chunk() {
      if (offset === source.length) {
        write(source.subarray(0, 44), false, 0, 'header overwrite', readback);
        return;
      }
      var end = Math.min(offset + 16384, source.length);
      var position = offset;
      var bytes = source.subarray(offset, end);
      offset = end;
      write(bytes, mode === 'append', mode === 'append' ? null : position, 'PCM @' + position, chunk);
    }
    write(header, false, 0, 'provisional header', chunk);
  }
  return {
    cancel: task.cancel, isPending: task.isPending,
    start: function () {
      if (started || task.isCancelled()) return;
      started = true; startedAt = task.now();
      if (['packaged', 'append', 'position', 'buffered'].indexOf(mode) < 0 || asset.byteLength > 262144) { fail('setup', 'invalid mode or >256KiB WAV cap'); return; }
      task.call('readArrayBuffer', { uri: asset.dataUri }, function (data, code, elapsed) {
        ioMs += elapsed;
        try { source = asBytes(data); validateOracleWav(source, asset); }
        catch (error) { fail('source', String(error)); return; }
        task.hash(source, 0, function (hash, duration, maximum) {
          hashMs += duration; maxBlockMs = Math.max(maxBlockMs, maximum);
          if (hash !== asset.hash32) { fail('source', 'hash32=' + hash + ' expected=' + asset.hash32); return; }
          callbacks.row('source', 'PASS PCM16 mono 22050Hz; samples=' + asset.sampleCount + ' hash32=' + hash);
          if (mode === 'packaged') { source = null; callbacks.ready(asset.uri); return; }
          task.call('get', { uri: uri }, function () { fail('check', 'target exists; refusing overwrite'); }, function (data, code) {
            if (Number(code) !== 301) { fail('check', String(code) + ' ' + String(data)); return; }
            beginWrites();
          });
        });
      }, function (data, code) { fail('source', String(code) + ' ' + String(data)); });
    }
  };
}
