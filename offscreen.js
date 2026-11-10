// Listen for audio playback commands from the service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'play_sound') {
    try {
      playSynthesizedSound(
        message.soundType || 'chime',
        message.volume !== undefined ? message.volume : 1.0,
        message.study
      );
      sendResponse({ success: true });
    } catch (err) {
      console.error("Audio playback error:", err);
      sendResponse({ success: false, error: err.message });
    }
    return true; // Keep message channel open for async response
  }
});

/**
 * Synthesizes dynamic, high-quality audio alerts using the Web Audio and SpeechSynthesis APIs.
 * @param {string} type - The sound type ('chime', 'beep', 'synth', 'melody', 'voice', 'sweet', 'cosmic', 'alert')
 * @param {number} volumeMultiplier - Master volume scale (0.0 to 1.0)
 * @param {object} study - Optional study details to read out
 */
function playSynthesizedSound(type, volumeMultiplier, study = null) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    console.warn("Web Audio API not supported in this browser.");
    return;
  }

  // 1. Text-To-Speech SpeechSynthesis Voice Alert
  if (type === 'voice') {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel(); // Cancel any current speeches
      let text = "New study available";
      if (study && study.name) {
        // Remove common emojis and symbols from the title for clean reading
        let cleanName = study.name.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDC00-\uDFFF]/g, '').trim();
        text = `New study: ${cleanName}. Reward is ${study.reward} pounds.`;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.volume = Math.max(0, Math.min(1, volumeMultiplier));
      window.speechSynthesis.speak(utterance);
    }
    return;
  }


  // 2. Synthesized Web Audio Tones
  const audioCtx = new AudioContextClass();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  const now = audioCtx.currentTime;

  // Create DynamicsCompressorNode to boost volume without clipping
  const compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-24, now);
  compressor.knee.setValueAtTime(30, now);
  compressor.ratio.setValueAtTime(12, now);
  compressor.attack.setValueAtTime(0.003, now);
  compressor.release.setValueAtTime(0.25, now);
  compressor.connect(audioCtx.destination);

  // Master Gain Node for volume control with 4.5x boost
  const masterGain = audioCtx.createGain();
  masterGain.gain.setValueAtTime(volumeMultiplier * 4.5, now);
  masterGain.connect(compressor);

  // PlayTone helper connecting through masterGain
  const playTone = (freq, startTime, duration, toneVolume, waveType = 'sine') => {
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.type = waveType;
    osc.frequency.setValueAtTime(freq, startTime);

    gainNode.gain.setValueAtTime(toneVolume, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(gainNode);
    gainNode.connect(masterGain);

    osc.start(startTime);
    osc.stop(startTime + duration);
  };

  if (type === 'chime') {
    // Beautiful dual-tone bell chime with a pleasant decay
    playTone(523.25, now, 0.6, 0.15);       // C5
    playTone(659.25, now + 0.08, 0.6, 0.12); // E5
    playTone(783.99, now + 0.16, 0.8, 0.10); // G5

  } else if (type === 'beep') {
    // Classic double digital beep (square wave)
    playTone(880, now, 0.08, 0.08, 'square');        // High beep
    playTone(880, now + 0.14, 0.08, 0.08, 'square'); // High beep

  } else if (type === 'synth') {
    // Futuristic frequency-sweeping synth (triangle wave)
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(261.63, now); // C4
    osc.frequency.exponentialRampToValueAtTime(880.00, now + 0.4); // Sweep up to A5

    gainNode.gain.setValueAtTime(0.15, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc.connect(gainNode);
    gainNode.connect(masterGain);

    osc.start(now);
    osc.stop(now + 0.45);

  } else if (type === 'melody') {
    // Joyous, shimmering four-note arpeggio (sine wave)
    playTone(523.25, now, 0.35, 0.12);        // C5
    playTone(659.25, now + 0.12, 0.35, 0.12); // E5
    playTone(783.99, now + 0.24, 0.35, 0.12); // G5
    playTone(1046.50, now + 0.36, 0.50, 0.12); // C6

  } else if (type === 'sweet') {
    // Sweet high-pitch bell tone
    playTone(880, now, 0.8, 0.15); // A5
    playTone(1760, now, 0.4, 0.05); // High octave harmonic

  } else if (type === 'cosmic') {
    // Shimmering space sound sweeps
    const osc1 = audioCtx.createOscillator();
    const gainNode1 = audioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(330, now);
    osc1.frequency.linearRampToValueAtTime(495, now + 1.0);
    gainNode1.gain.setValueAtTime(0.1, now);
    gainNode1.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
    osc1.connect(gainNode1);
    gainNode1.connect(masterGain);
    osc1.start(now);
    osc1.stop(now + 1.0);

    const osc2 = audioCtx.createOscillator();
    const gainNode2 = audioCtx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(440, now + 0.15);
    osc2.frequency.linearRampToValueAtTime(660, now + 0.9);
    gainNode2.gain.setValueAtTime(0.08, now + 0.15);
    gainNode2.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    osc2.connect(gainNode2);
    gainNode2.connect(masterGain);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.9);

  } else if (type === 'alert') {
    // High-alert dual triangle alert ring
    playTone(1000, now, 0.15, 0.15, 'triangle');
    playTone(1200, now + 0.18, 0.25, 0.15, 'triangle');
  } else if (type === 'nuclear') {
    // Nuclear Siren Alert
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc1.type = 'sawtooth';
    osc2.type = 'sine';

    osc1.frequency.setValueAtTime(800, now);
    osc1.frequency.linearRampToValueAtTime(1200, now + 0.35);
    osc1.frequency.linearRampToValueAtTime(800, now + 0.7);
    osc1.frequency.linearRampToValueAtTime(1200, now + 1.05);
    osc1.frequency.linearRampToValueAtTime(800, now + 1.4);

    const lfoGain = audioCtx.createGain();
    lfoGain.gain.setValueAtTime(40, now);
    osc2.frequency.setValueAtTime(6, now); // Vibrato
    osc2.connect(lfoGain);
    lfoGain.connect(osc1.frequency);

    gainNode.gain.setValueAtTime(0.25, now);
    gainNode.gain.linearRampToValueAtTime(0.25, now + 1.2);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

    osc1.connect(gainNode);
    gainNode.connect(masterGain);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 1.5);
    osc2.stop(now + 1.5);

  } else if (type === 'laser') {
    // Laser Zap
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1500, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.45);

    gainNode.gain.setValueAtTime(0.3, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc.connect(gainNode);
    gainNode.connect(masterGain);

    osc.start(now);
    osc.stop(now + 0.45);

  } else if (type === 'success') {
    // Shimmering success arpeggio
    playTone(523.25, now, 0.25, 0.2, 'triangle');       // C5
    playTone(659.25, now + 0.1, 0.25, 0.2, 'triangle');  // E5
    playTone(783.99, now + 0.2, 0.25, 0.2, 'triangle');  // G5
    playTone(1046.50, now + 0.3, 0.25, 0.2, 'triangle'); // C6
    playTone(1318.51, now + 0.4, 0.6, 0.25, 'triangle'); // E6
  }
}
