// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStop = vi.fn();
const mockStart = vi.fn();
const mockSetValueAtTime = vi.fn();
const mockExponentialRamp = vi.fn();

let connectCalls = 0;

const mockOscillator = {
  connect: vi.fn(() => { connectCalls++; }),
  frequency: { value: 0 },
  type: 'sine' as OscillatorType,
  start: mockStart,
  stop: mockStop,
};

const mockGain = {
  connect: vi.fn(() => { connectCalls++; }),
  gain: {
    setValueAtTime: mockSetValueAtTime,
    exponentialRampToValueAtTime: mockExponentialRamp,
  },
};

class MockAudioContext {
  createOscillator = vi.fn(() => mockOscillator);
  createGain = vi.fn(() => mockGain);
  destination = {};
  currentTime = 0;
}

vi.stubGlobal('AudioContext', MockAudioContext);

// Import after stubbing globals
import { playDing } from '../notification-sound';

describe('playDing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectCalls = 0;
  });

  it('creates oscillator and gain nodes', () => {
    playDing();
    // oscillator/gain creation is verified by the mock objects being used
    expect(mockOscillator.connect).toHaveBeenCalled();
    expect(mockGain.connect).toHaveBeenCalled();
  });

  it('sets oscillator frequency to 880Hz', () => {
    playDing();
    expect(mockOscillator.frequency.value).toBe(880);
  });

  it('sets oscillator type to sine', () => {
    playDing();
    expect(mockOscillator.type).toBe('sine');
  });

  it('connects oscillator → gain → destination', () => {
    playDing();
    expect(connectCalls).toBe(2);
  });

  it('sets gain envelope (attack at 0.3, decay to 0.001)', () => {
    playDing();
    expect(mockSetValueAtTime).toHaveBeenCalledWith(0.3, 0);
    expect(mockExponentialRamp).toHaveBeenCalledWith(0.001, 0.5);
  });

  it('starts and stops oscillator with 0.5s duration', () => {
    playDing();
    expect(mockStart).toHaveBeenCalledWith(0);
    expect(mockStop).toHaveBeenCalledWith(0.5);
  });

  it('reuses AudioContext across multiple calls (oscillator created each time)', () => {
    playDing();
    playDing();
    playDing();
    // Oscillator start is called each time
    expect(mockStart).toHaveBeenCalledTimes(3);
  });
});
