// Owns one uniquely named diagnostic file. It never overwrites an existing file.
// Cancellation cannot abort system I/O; cleanup waits for its callback first.
export function scratchFile(file, uri, bytes, callbacks) {
  var pending = false;
  var cancelled = false;
  var owns = false;
  var cleaned = false;
  var started = false;

  function call(method, args, success, fail) {
    var settled = false;
    pending = true;
    function settle(fn, data, code) {
      if (settled) return;
      settled = true;
      pending = false;
      fn(data, code);
    }
    args.success = function (data) { settle(success, data); };
    args.fail = function (data, code) { settle(fail, data, code); };
    try {
      if (typeof file[method] !== 'function') throw new Error('UNSUPPORTED ' + method);
      file[method](args);
    } catch (error) { settle(fail, String(error), 'JS'); }
  }
  function cleanup() {
    if (pending || !owns || cleaned) return;
    cleaned = true;
    call('delete', { uri: uri }, function () {
      bytes = null;
      callbacks.cleanup('PASS removed scratch file');
    }, function (data, code) {
      bytes = null;
      callbacks.cleanup('FAIL ' + code + ' ' + String(data) + '; leftover: ' + uri);
    });
  }
  function fail(stage, data, code) {
    if (!cancelled) callbacks.error(stage, String(code) + ' ' + String(data));
    cancelled = true;
    cleanup();
  }
  function read() {
    if (cancelled) { cleanup(); return; }
    call('readArrayBuffer', { uri: uri }, function (data) {
      if (cancelled) { cleanup(); return; }
      var actual = data && data.buffer;
      var equal = actual && actual.length === bytes.length;
      if (equal) {
        for (var i = 0; i < bytes.length; i++) {
          if (actual[i] !== bytes[i]) { equal = false; break; }
        }
      }
      if (!equal) { fail('read', 'byte mismatch', 'VERIFY'); return; }
      callbacks.stage('read', 'PASS ' + bytes.length + ' bytes verified');
      callbacks.ready(uri);
    }, function (data, code) { fail('read', data, code); });
  }
  function write() {
    if (cancelled) return;
    owns = true;
    call('writeArrayBuffer', { uri: uri, buffer: bytes, append: false, position: 0 }, function () {
      if (cancelled) { cleanup(); return; }
      callbacks.stage('write', 'PASS ' + bytes.length + ' bytes');
      read();
    }, function (data, code) { fail('write', data, code); });
  }
  return {
    start: function () {
      if (started || cancelled) return;
      started = true;
      call('get', { uri: uri }, function () {
        fail('check', 'target already exists; refusing overwrite', 'EXISTS');
      }, function (data, code) {
        if (cancelled) return;
        if (Number(code) === 301) write();
        else fail('check', data, code);
      });
    },
    cancel: function () { cancelled = true; cleanup(); },
    isPending: function () { return pending; }
  };
}

// Same ownership and cancellation contract as scratchFile, but the payload
// stage is file.copy from an existing source (e.g. a package resource) into
// the owned file. Verifying the copy result is left to the caller before
// cancel(); a failed copy still triggers cleanup of a potential partial file.
export function copyFile(file, srcUri, uri, callbacks) {
  var pending = false;
  var cancelled = false;
  var owns = false;
  var cleaned = false;
  var started = false;

  function call(method, args, success, fail) {
    var settled = false;
    pending = true;
    function settle(fn, data, code) {
      if (settled) return;
      settled = true;
      pending = false;
      fn(data, code);
    }
    args.success = function (data) { settle(success, data); };
    args.fail = function (data, code) { settle(fail, data, code); };
    try {
      if (typeof file[method] !== 'function') throw new Error('UNSUPPORTED ' + method);
      file[method](args);
    } catch (error) { settle(fail, String(error), 'JS'); }
  }
  function cleanup() {
    if (pending || !owns || cleaned) return;
    cleaned = true;
    call('delete', { uri: uri }, function () {
      callbacks.cleanup('PASS removed scratch file');
    }, function (data, code) {
      callbacks.cleanup('FAIL ' + code + ' ' + String(data) + '; leftover: ' + uri);
    });
  }
  function fail(stage, data, code) {
    if (!cancelled) callbacks.error(stage, String(code) + ' ' + String(data));
    cancelled = true;
    cleanup();
  }
  function copy() {
    if (cancelled) return;
    owns = true;
    call('copy', { srcUri: srcUri, dstUri: uri }, function () {
      if (cancelled) { cleanup(); return; }
      callbacks.ready(uri);
    }, function (data, code) { fail('copy', data, code); });
  }
  return {
    start: function () {
      if (started || cancelled) return;
      started = true;
      call('get', { uri: uri }, function () {
        fail('check', 'target already exists; refusing overwrite', 'EXISTS');
      }, function (data, code) {
        if (cancelled) return;
        if (Number(code) === 301) copy();
        else fail('check', data, code);
      });
    },
    cancel: function () { cancelled = true; cleanup(); },
    isPending: function () { return pending; }
  };
}
