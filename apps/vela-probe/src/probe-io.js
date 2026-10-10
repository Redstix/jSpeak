import { hashBytes } from './probe'

export function asBytes(data) {
  var value = data && data.buffer;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error('readArrayBuffer returned neither Uint8Array nor ArrayBuffer');
}

// Some native bridges consume the whole backing ArrayBuffer of a Uint8Array.
// A subarray is therefore not a safe write payload. Borrow an exact store, or
// copy only the requested view into one. Keep it unchanged until I/O settles.
export function nativeWriteBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('write payload must be Uint8Array');
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes;
  var exact = new Uint8Array(bytes.byteLength);
  exact.set(bytes);
  return exact;
}

export function checkRange(size, position, length) {
  if (size < 0 || size > 2147483647 || position < 0 || length < 0 ||
      size !== Math.floor(size) || position !== Math.floor(position) || length !== Math.floor(length) ||
      position > size || length > size - position) throw new RangeError('read outside manifest bounds');
}

// Exactly one native operation and one JS continuation per task. A JS timeout
// does not abort native I/O: isPending remains true until its real callback.
export function createProbeTask(file, hooks, environment) {
  var env = environment || {};
  var now = env.now || function () { return Date.now(); };
  var later = env.later || function (fn, ms) { return setTimeout(fn, ms); };
  var clear = env.clear || function (id) { clearTimeout(id); };
  var cancelled = false;
  var pending = false;
  var continuation = null;
  var watchdog = null;
  function cancel() {
    if (cancelled) return;
    cancelled = true;
    if (continuation !== null) clear(continuation);
    if (watchdog !== null) clear(watchdog);
    continuation = null;
    watchdog = null;
    if (!pending && hooks.idle) hooks.idle();
  }
  function fatal(message) {
    if (!cancelled && hooks.error) hooks.error(message);
    cancel();
  }
  function defer(fn) {
    if (cancelled) return;
    continuation = later(function () {
      continuation = null;
      if (cancelled) return;
      try { fn(); } catch (error) { fatal(String(error)); }
    }, 10);
  }
  function call(method, args, success, failure, cleanup) {
    if (cancelled && !cleanup) return;
    if (pending) throw new Error('overlapping native I/O');
    pending = true;
    var settled = false;
    var start = now();
    watchdog = later(function () {
      watchdog = null;
      if (settled) return;
      if (cleanup) {
        if (hooks.cleanupTimeout) hooks.cleanupTimeout();
      } else fatal(method + ' timeout 15s; native I/O still pending');
    }, 15000);
    function settle(fn, data, code) {
      if (settled) return;
      settled = true;
      pending = false;
      if (watchdog !== null) clear(watchdog);
      watchdog = null;
      if (cancelled && !cleanup) { if (hooks.idle) hooks.idle(); return; }
      try { fn(data, code, now() - start); } catch (error) { fatal(method + ' callback ' + String(error)); }
    }
    args.success = function (data) { settle(success, data); };
    args.fail = function (data, code) { settle(failure, data, code); };
    try {
      if (typeof file[method] !== 'function') throw new Error('UNSUPPORTED ' + method);
      file[method](args);
    } catch (error) { settle(failure, String(error), 'JS'); }
  }
  return {
    now: now, defer: defer, call: call, cancel: cancel,
    isPending: function () { return pending; },
    isCancelled: function () { return cancelled; },
    hash: function (bytes, seed, done) {
      var offset = 0;
      var state = seed | 0;
      var elapsed = 0;
      var maximum = 0;
      function step() {
        var end = Math.min(offset + 4096, bytes.length);
        var start = now();
        state = hashBytes(bytes, offset, end, state);
        var duration = now() - start;
        elapsed += duration;
        maximum = Math.max(maximum, duration);
        offset = end;
        if (offset === bytes.length) done(state, elapsed, maximum);
        else defer(step);
      }
      defer(step);
    }
  };
}
