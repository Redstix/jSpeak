import { createEnglishSynthesizer } from '../../../src/core/english-synthesis'

const TEST_TEXT = 'Hello world.'

function hashBytes(bytes, seed) {
  var state = seed | 0
  for (var i = 0; i < bytes.length; i++) {
    state ^= bytes[i]
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
  }
  return state | 0
}

function call(method, target, args, success, failure) {
  args.success = success
  args.fail = function (data, code) { failure(String(code) + ' ' + String(data)) }
  try {
    if (typeof target[method] !== 'function') throw new Error('UNSUPPORTED ' + method)
    target[method](args)
  } catch (error) { failure(String(error)) }
}

export function createTtsSession(file, audio, assets, dictionaryManifest, callbacks, buildStamp) {
  var token = 0, cancelled = false, activeUri = null, ownsFile = false, pendingFile = false
  var bytesById = {}
  var progress = 'WAITING'

  function row(label, value) { if (!cancelled) callbacks.row(label, value) }
  function fail(message) {
    if (cancelled) return
    row('流程', 'FAIL ' + message)
    callbacks.fail(message)
    cleanup()
  }
  function cleanup() {
    if (!ownsFile || pendingFile || !activeUri) return
    var uri = activeUri
    pendingFile = true
    call('delete', file, { uri: uri }, function () {
      pendingFile = false; ownsFile = false; activeUri = null
      row('清理', 'PASS removed generated WAV')
    }, function (message) {
      pendingFile = false; ownsFile = false; activeUri = null
      row('清理', 'FAIL delete ' + message + '; leftover: ' + uri)
    })
  }
  function loadFile(index) {
    if (cancelled || index === assets.files.length) return synthesize()
    var item = assets.files[index]
    row('数据', 'READING ' + item.id + ' ' + item.byteLength + 'B')
    call('readArrayBuffer', file, { uri: item.uri }, function (data) {
      var value = data && data.buffer
      if (!(value instanceof Uint8Array) && !(value instanceof ArrayBuffer)) { fail(item.id + ' read type'); return }
      var bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
      if (bytes.length !== item.byteLength) { fail(item.id + ' length=' + bytes.length); return }
      if (hashBytes(bytes, 0) !== item.hash32) { fail(item.id + ' hash32'); return }
      bytesById[item.id] = bytes
      row('数据', 'PASS ' + item.id + ' ' + bytes.length + 'B')
      setTimeout(function () { if (!cancelled) loadFile(index + 1) }, 0)
    }, fail)
  }
  function synthesize() {
    if (cancelled) return
    row('合成', 'RUNNING text→commands→PCM')
    var synthesizer = createEnglishSynthesizer({
      dictionaryBytes: bytesById.en_dict, dictionaryManifest: dictionaryManifest,
      phontabBytes: bytesById.phontab, phonindexBytes: bytesById.phonindex,
      phondataBytes: bytesById.phondata,
    })
    var started = Date.now()
    synthesizer.synthesizeWav(TEST_TEXT, { shouldContinue: callbacks.shouldContinue }).then(function (result) {
      if (cancelled || !callbacks.shouldContinue()) return
      var elapsed = Date.now() - started
      row('合成', 'PASS samples=' + result.pcm.length + '; bytes=' + result.wav.length + '; elapsed=' + elapsed + 'ms')
      writeFile(result.wav)
    }, function (error) { fail('JS synthesis ' + String(error)) })
  }
  function writeFile(wav) {
    if (cancelled) return
    var sequence = Date.now()
    activeUri = 'internal://files/jspeak-tts-050-' + sequence + '.wav'
    ownsFile = true; pendingFile = true
    row('写入', 'RUNNING ' + activeUri)
    call('writeArrayBuffer', file, { uri: activeUri, buffer: wav, append: false, position: 0 }, function () {
      pendingFile = false
      row('写入', 'PASS ' + wav.length + 'B')
      verify(wav)
    }, function (message) { pendingFile = false; fail('write ' + message) })
  }
  function verify(expected) {
    if (cancelled) return
    pendingFile = true
    call('readArrayBuffer', file, { uri: activeUri }, function (data) {
      pendingFile = false
      var value = data && data.buffer
      var actual = value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : null
      if (!actual || actual.length !== expected.length) { fail('readback len=' + (actual && actual.length)); return }
      for (var i = 0; i < expected.length; i++) if (actual[i] !== expected[i]) { fail('readback byte=' + i); return }
      row('读回', 'PASS ' + actual.length + 'B all equal')
      play()
    }, function (message) { pendingFile = false; fail('readback ' + message) })
  }
  function play() {
    if (cancelled) return
    row('播放', 'WAITING @system.audio')
    callbacks.listening()
    try {
      audio.onplay = function () { row('播放', 'EVENT onplay') }
      audio.onended = function () {
        row('播放', 'EVENT onended')
        callbacks.done('DONE text→WAV→playback；听感待用户确认')
        cleanup()
      }
      audio.onerror = function (data) { fail('audio ' + String(data)) }
      audio.src = activeUri
      audio.play()
    } catch (error) { fail('audio ' + String(error)) }
  }
  return {
    start: function () {
      token++
      row('身份', '0.5.2-A ' + buildStamp + '；text=' + TEST_TEXT)
      row('流程', 'LOADING packaged data')
      loadFile(0)
    },
    cancel: function () {
      cancelled = true; token++
      try { audio.onplay = null; audio.onended = null; audio.onerror = null; audio.stop() } catch (error) {}
      cleanup()
    }
  }
}
