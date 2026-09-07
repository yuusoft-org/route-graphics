const hasVideoPlaybackSettled = (video) => {
  if (!video) return true;
  if (video.ended) return true;
  if (video.error) return true;
  if (
    typeof video.NETWORK_NO_SOURCE === "number" &&
    video.networkState === video.NETWORK_NO_SOURCE
  ) {
    return true;
  }

  return (
    Number.isFinite(video.duration) &&
    video.duration > 0 &&
    video.currentTime >= video.duration
  );
};

export const clearVideoPlaybackTracking = ({ videoElement, video }) => {
  if (video && videoElement?._videoEndedListener) {
    video.removeEventListener("ended", videoElement._videoEndedListener);
  }

  if (video && videoElement?._videoErrorListener) {
    video.removeEventListener("error", videoElement._videoErrorListener);
  }

  if (videoElement) {
    videoElement._videoEndedListener = undefined;
    videoElement._videoErrorListener = undefined;
    videoElement._playbackStateVersion = null;
  }
};

export const disposeVideoPlayback = (videoElement, completionTracker) => {
  if (videoElement._playbackDisposed) return;
  videoElement._playbackDisposed = true;
  const version = videoElement._playbackStateVersion;
  const texture = videoElement.texture;
  const video = texture?.source?.resource;
  // Pixi 8.10.2 does not detach dynamic texture listeners in Sprite.destroy().
  texture?.off?.("update", videoElement.onViewUpdate, videoElement);
  clearVideoPlaybackTracking({ videoElement, video });
  video?.pause?.();
  unregisterManagedVideoSprite(videoElement);
  if (version !== null && version !== undefined)
    completionTracker?.complete?.(version);
};

export const syncVideoPlaybackTracking = ({
  videoElement,
  video,
  loop,
  completionTracker,
}) => {
  clearVideoPlaybackTracking({ videoElement, video });

  if (loop ?? false) {
    return;
  }

  if (hasVideoPlaybackSettled(video)) {
    return;
  }

  const playbackStateVersion = completionTracker.getVersion();
  completionTracker.track(playbackStateVersion);

  const completePlayback = () => {
    completionTracker.complete(playbackStateVersion);
  };

  video.addEventListener("ended", completePlayback);
  video.addEventListener("error", completePlayback);
  videoElement._videoEndedListener = completePlayback;
  videoElement._videoErrorListener = completePlayback;
  videoElement._playbackStateVersion = playbackStateVersion;
};
import { unregisterManagedVideoSprite } from "./managedVideoTextureSizing.js";
