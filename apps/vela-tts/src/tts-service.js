import { createEnglishSynthesizer } from '../../../src/core/english-synthesis'
import { createCmnSynthesizer } from '../../../src/core/cmn-synthesis'

var SAMPLE_RATE = 22050

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

function median(values) {
  var sorted = values.slice().sort(function (left, right) { return left - right })
  return sorted[Math.floor(sorted.length / 2)]
}

export function createTtsSession(file, audio, assets, callbacks) {
  var token = 0, cancelled = false, activeUri = null, ownsFile = false, pendingFile = false
  var bytesById = {}, loaded = false, synthesizer = null
  var current = null

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
  function loadFile(index, done) {
    if (cancelled) return
    if (index === assets.files.length) { loaded = true; done(); return }
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
      setTimeout(function () { if (!cancelled) loadFile(index + 1, done) }, 0)
    }, fail)
  }
  function createSynthesizer() {
    var dictionaryBytes = bytesById[assets.dictionaryId]
    if (assets.language === 'cmn') {
      return createCmnSynthesizer({
        dictionaryBytes: dictionaryBytes,
        phontabBytes: bytesById.phontab, phonindexBytes: bytesById.phonindex,
        phondataBytes: bytesById.phondata
      })
    }
    return createEnglishSynthesizer({
      dictionaryBytes: dictionaryBytes, dictionaryManifest: assets.dictionaryManifest,
      phontabBytes: bytesById.phontab, phonindexBytes: bytesById.phonindex,
      phondataBytes: bytesById.phondata
    })
  }
  function complete(runs, last) {
    var elapsed = runs.map(function (item) { return item.elapsed })
    var audioMs = last ? last.pcm.length / SAMPLE_RATE * 1000 : 0
    var average = elapsed.reduce(function (sum, value) { return sum + value }, 0) / elapsed.length
    var rtf = audioMs > 0 ? average / audioMs : 0
    row('测试', 'PASS n=' + runs.length + '; elapsed min/median/max=' +
      Math.min.apply(null, elapsed) + '/' + median(elapsed) + '/' + Math.max.apply(null, elapsed) +
      'ms; samples=' + (last ? last.pcm.length : 0) + '; audio=' + audioMs.toFixed(1) +
      'ms; RTF(avg)=' + rtf.toFixed(4))
    row('合成', 'PASS samples=' + (last ? last.pcm.length : 0) + '; bytes=' + (last ? last.wav.length : 0))
    if (current.play === false) {
      callbacks.done('DONE n=' + runs.length + '；已测合成，未播放')
      cleanup()
      return
    }
    writeFile(last.wav)
  }
  function synthesizeRuns(options) {
    if (cancelled) return
    var repeat = options.repeat || 1
    var runs = [], index = 0
    function next() {
      if (cancelled || !callbacks.shouldContinue()) return
      row('合成', 'RUNNING ' + (index + 1) + '/' + repeat + ' text→commands→PCM')
      var started = Date.now()
      synthesizer.synthesizeWav(options.text || assets.testText, {
        shouldContinue: callbacks.shouldContinue
      }).then(function (result) {
        if (cancelled || !callbacks.shouldContinue()) return
        var elapsed = Date.now() - started
        runs.push({ elapsed: elapsed, samples: result.pcm.length })
        index++
        if (index < repeat) { setTimeout(next, 0); return }
        complete(runs, result)
      }, function (error) { fail('JS synthesis ' + String(error)) })
    }
    next()
  }
  function writeFile(wav) {
    if (cancelled) return
    var sequence = Date.now()
    activeUri = 'internal://files/jspeak-tts-' + assets.versionName.replace(/[^a-z0-9]+/gi, '') + '-' + sequence + '.wav'
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
    start: function (options) {
      current = options || {}
      token++
      row('身份', assets.versionName + ' A ' + assets.buildStamp + '；language=' + assets.language +
        '；text=' + (current.text || assets.testText))
      function run() {
        if (cancelled) return
        try {
          if (!synthesizer) {
            var initialized = Date.now()
            synthesizer = createSynthesizer()
            row('初始化', 'PASS ' + (Date.now() - initialized) + 'ms')
          }
        } catch (error) { fail('initialization ' + String(error)); return }
        synthesizeRuns(current)
      }
      if (loaded) { run(); return }
      row('流程', 'LOADING packaged data')
      loadFile(0, run)
    },
    cancel: function () {
      cancelled = true; token++
      try { audio.onplay = null; audio.onended = null; audio.onerror = null; audio.stop() } catch (error) {}
      cleanup()
    }
  }
}
