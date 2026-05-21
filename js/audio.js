// --- Audio Context ---
let audioCtx;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function snapToScale(freq) {
    // Convert frequency to nearest MIDI note
    const baseFreq = 440;
    // Calculate semitones from A4
    const semitones = 12 * Math.log2(freq / baseFreq);
    let midi = Math.round(semitones) + 69;

    // C Major Pentatonic: C, D, E, G, A
    // Relative to C (0): 0, 2, 4, 7, 9
    // MIDI 60 is C4. 60 % 12 = 0.
    const allowedPitchClasses = [0, 2, 4, 7, 9];

    // Find closest valid note by checking neighbors
    // We check current note, then +1/-1, +2/-2, etc.
    let bestMidi = midi;
    let found = false;

    for (let offset = 0; offset < 6; offset++) {
        // Check +offset
        let m1 = midi + offset;
        if (allowedPitchClasses.includes((m1 % 12 + 12) % 12)) {
            bestMidi = m1;
            found = true;
            break;
        }
        // Check -offset
        if (offset > 0) {
            let m2 = midi - offset;
            if (allowedPitchClasses.includes((m2 % 12 + 12) % 12)) {
                bestMidi = m2;
                found = true;
                break;
            }
        }
    }

    // Convert back to frequency
    return baseFreq * Math.pow(2, (bestMidi - 69) / 12);
}

function playQuakeSound(q, delay = 0) {
    if (!audioCtx) return;

    // Safety: Clamp magnitude (handle negative or non-finite values)
    const safeMag = Math.max(0, Number.isFinite(q.realMag) ? q.realMag : 0);

    // Safety: Ensure delay is finite
    if (!Number.isFinite(delay)) delay = 0;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const panner = audioCtx.createStereoPanner();

    // Frequency Calculation (Pitch)
    // 1. Small/Medium (< 5.0): Higher base (800Hz) for glassy pings.
    // 2. Large (>= 5.0): Start lower (300Hz) and drop heavily with magnitude (Bass).
    let freq;
    if (safeMag < 5.0) {
        // Small: High, clear tone
        // Base 800Hz, drops slightly with depth
        freq = 800 - (q.depth * 0.5);
        osc.type = 'sine';
    } else {
        // Large: Low, heavy rumble
        // Base 300Hz, drop 80Hz per magnitude above 5.0
        // Mag 6: 220Hz
        // Mag 7: 140Hz
        // Mag 8: 60Hz
        // Mag 9: ~30Hz
        freq = 300 - ((safeMag - 5.0) * 80) - (q.depth * 0.1);
        // Use Sawtooth/Square for grit
        osc.type = safeMag >= 7.5 ? 'square' : 'sawtooth';
    }

    // Safety Cap: Minimum 30Hz to avoid sub-sonic issues, snap to scale
    freq = Math.max(20, freq);
    freq = snapToScale(freq);
    osc.frequency.value = freq;

    // Volume: Exponential curve (Power 3)
    // Mag 3 ~ very quiet, Mag 8 ~ loud
    // Increased floor slightly for small quakes (0.02 base)
    const vol = Math.min(0.5, (Math.pow(safeMag, 3) / 1500) + 0.02);

    // Safety check for volume
    const safeVol = Number.isFinite(vol) ? vol : 0;

    // Pan: -180 to 180 -> -1 to 1
    panner.pan.value = q.lon / 180;

    // Connect nodes
    osc.connect(panner);
    panner.connect(gain);
    gain.connect(audioCtx.destination);

    // Envelope (ADSR-ish)
    const now = audioCtx.currentTime + delay; // Apply calculated delay
    osc.start(now);

    // Duration varies by magnitude: Mag 3 = 0.2s, Mag 9 = 1.4s
    const duration = 0.2 + (Math.max(0, safeMag - 3) * 0.2);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(safeVol, now + 0.02); // Fast attack
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.stop(now + duration + 0.1);
}
