const audioContext = new (window.AudioContext || window.webkitAudioContext)();

/**
 * Manage audio assets
 */
export class AudioAsset {
  /**
   * @type {Object.<string, AudioBuffer>}
   */
  static loadedAssets = {};

  /**
   * @param {string} key
   * @param {ArrayBuffer} arrayBuffer
   * @returns {Promise<undefined>}
   */
  static load = async (key, arrayBuffer) => {
    if (AudioAsset.loadedAssets[key]) {
      return;
    }
    if (arrayBuffer.byteLength === 0) {
      return;
    }
    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      AudioAsset.loadedAssets[key] = audioBuffer;
    } catch (error) {
      console.error(`AudioAsset.load: Failed to decode ${key}:`, error);
    }
  };

  /**
   *
   * @param {string} url
   * @returns {AudioBuffer | undefined}
   */
  static getAsset = (url) => {
    const arrayBuffer = AudioAsset.loadedAssets[url];
    return arrayBuffer;
  };
}

class AudioPlayer {
  /**
   * @type {AudioBufferSourceNode}
   */
  _audioSource;

  /**
   * @type {GainNode}
   */
  _gainNode;

  /**
   * @type {number}
   */
  volume = 1.0;

  /**
   * @type {string}
   */
  id;

  /**
   * @type {string}
   */
  url;

  /**
   * @type {boolean}
   */
  loop = false;

  /**
   *
   * @param {string} id;
   * @param {Object} options
   * @param {string} options.url
   * @param {boolean} [options.loop=false]
   * @param {number} [options.volume=1.0]
   */
  constructor(id, options) {
    this.id = id;
    this.url = options.url;
    this.loop = options.loop || false;
    this.volume = options.volume ?? 1.0;
    this._gainNode = audioContext.createGain();
    this._gainNode.gain.value = this.volume;
    this._gainNode.connect(audioContext.destination);
  }

  play = () => {
    const audioBuffer = AudioAsset.getAsset(this.url);
    if (!audioBuffer) {
      console.warn("AudioPlayer.play: Asset not found", this.url);
      return;
    }
    this._audioSource = audioContext.createBufferSource();
    this._audioSource.buffer = audioBuffer;
    this._audioSource.loop = this.loop;
    this._gainNode.gain.setValueAtTime(this.volume, audioContext.currentTime);
    this._audioSource.connect(this._gainNode);
    this._audioSource.start(0);
  };

  stop = () => {
    if (this._audioSource) {
      this._audioSource.stop();
      this._audioSource.disconnect();
      this._gainNode.disconnect();
      this._gainNode = audioContext.createGain();
      this._gainNode.gain.value = this.volume;
      this._gainNode.connect(audioContext.destination);
    }
  };
}

/**
 * @typedef {Object} AudioElement
 * @property {string} id - The ID of the audio element
 * @property {string} url - The URL of the audio file
 * @property {boolean} [loop=false] - Whether the audio should loop
 * @property {number} [volume=1.0] - Volume between 0 and 1
 */

/**
 * Manage audio elements
 */
export class AudioStage {
  /**
   * @type {AudioPlayer[]}
   */
  audioPlayers = [];

  /**
   * @type {AudioElement[]}
   */
  stageAudios = [];

  /**
   *
   * @param {AudioElement} element
   */
  add = (element) => {
    this.stageAudios.push(element);
  };

  /**
   *
   * @param {string} id
   */
  remove = (id) => {
    this.stageAudios = this.stageAudios.filter((audio) => audio.id !== id);
  };

  /**
   *
   * @param {string} id
   * @returns {AudioElement | undefined}
   */
  getById = (id) => {
    return this.stageAudios.find((audio) => audio.id === id);
  };

  /**
   * Tick
   */
  tick = () => {
    for (const audio of this.stageAudios) {
      const audioPlayer = this.audioPlayers.find(
        (player) => player.id === audio.id,
      );

      // add
      if (!audioPlayer) {
        const player = new AudioPlayer(audio.id, {
          url: audio.url,
          loop: audio.loop,
          volume: audio.volume ?? 1.0,
        });
        this.audioPlayers.push(player);
        player.play();
        return;
      }

      // check if need update
      if (audioPlayer.url !== audio.url || audioPlayer.loop !== audio.loop) {
        audioPlayer.stop();
        audioPlayer.url = audio.url;
        audioPlayer.loop = audio.loop ?? false;
        audioPlayer.play();
      }

      if (audioPlayer.volume !== (audio.volume ?? 1.0)) {
        audioPlayer.volume = audio.volume ?? 1.0;
        audioPlayer._gainNode.gain.value = audioPlayer.volume;
      }
    }

    // to be removed
    const toRemoveAudioPlayerIds = [];
    for (const player of this.audioPlayers) {
      if (!this.stageAudios.find((audio) => audio.id === player.id)) {
        player.stop();
        toRemoveAudioPlayerIds.push(player.id);
      }
    }
    this.audioPlayers = this.audioPlayers.filter(
      (player) => !toRemoveAudioPlayerIds.includes(player.id),
    );
  };

  destroy = () => {
    for (const player of this.audioPlayers) {
      player.stop();
    }
    this.audioPlayers = [];
    this.stageAudios = [];
  };
}
