import { useEffect, useRef } from 'react';

const VideoPlayer = ({ stream, userName, isLocal, videoRef, caption = '' }) => {
  const videoElementRef = useRef(null);

  useEffect(() => {
    const videoElement = videoRef || videoElementRef;
    
    if (!videoElement.current) return;
    
    // For local video, check if videoRef already has srcObject set (might be set directly)
    // If so, use that instead of the stream prop to avoid conflicts
    if (isLocal && videoRef && videoRef.current && videoRef.current.srcObject) {
      // Local video ref already has stream set, don't override it
      console.log('Local video ref already has srcObject, using existing:', userName);
      // Just ensure it's playing
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch(error => {
          console.error('Error playing local video:', userName, error);
        });
      }
      return;
    }
    
    if (stream) {
      console.log('Setting video srcObject for:', userName, 'isLocal:', isLocal, 'tracks:', stream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, readyState: t.readyState })));
      videoElement.current.srcObject = stream;
      
      // Ensure video plays on mobile - with retry
      const playPromise = videoElement.current.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            console.log('Video playing successfully for:', userName);
          })
          .catch(error => {
            console.error('Error playing video for:', userName, error);
            // Retry after a short delay
            setTimeout(() => {
              if (videoElement.current && videoElement.current.srcObject) {
                videoElement.current.play().catch(err => {
                  console.error('Retry play failed:', err);
                });
              }
            }, 500);
          });
      }
    } else {
      console.log('No stream available for:', userName, '- will show avatar');
      // Only clear srcObject if it's not the local video ref (which might be set directly)
      if (!isLocal || !videoRef) {
        videoElement.current.srcObject = null;
      }
    }

    return () => {
      // Don't clear srcObject for local video if videoRef is provided (it's managed externally)
      if (!isLocal || !videoRef) {
        if (videoElement.current && videoElement.current.srcObject) {
          videoElement.current.srcObject = null;
        }
      }
    };
  }, [stream, videoRef, userName, isLocal]);

  return (
    <div className="relative bg-gray-800 rounded-lg overflow-hidden aspect-video sm:aspect-video h-[180px] sm:h-auto min-h-[180px] sm:min-h-[240px] video-player-container">
      <video
        ref={videoRef || videoElementRef}
        autoPlay
        playsInline
        muted={isLocal}
        className="w-full h-full object-cover"
      />
      {/* Captions overlay - positioned above name label */}
      {caption && (
        <div className="absolute bottom-10 sm:bottom-14 left-0 right-0 flex justify-center px-2 sm:px-4 z-30">
          <div className="bg-black/90 backdrop-blur-sm rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 max-w-[95%] sm:max-w-[90%] shadow-2xl border border-white/20">
            <p className="text-white text-xs sm:text-sm font-medium text-center break-words leading-relaxed">
              {caption}
            </p>
          </div>
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/60 to-transparent p-2 sm:p-3 z-10">
        <div className="text-white text-xs sm:text-sm font-medium truncate">
          {userName} {isLocal && '(You)'}
        </div>
      </div>
      {(() => {
        // Check if video should be shown
        let shouldShowAvatar = false;
        
        if (isLocal && videoRef && videoRef.current) {
          // For local video, check the videoRef's srcObject
          const localSrcObject = videoRef.current.srcObject;
          if (!localSrcObject) {
            shouldShowAvatar = true;
          } else if (localSrcObject instanceof MediaStream) {
            const videoTracks = localSrcObject.getVideoTracks();
            shouldShowAvatar = !videoTracks || videoTracks.length === 0 || !videoTracks[0]?.enabled;
          }
        } else if (!stream) {
          shouldShowAvatar = true;
        } else {
          const videoTracks = stream.getVideoTracks();
          shouldShowAvatar = !videoTracks || videoTracks.length === 0 || !videoTracks[0]?.enabled;
        }
        
        return shouldShowAvatar;
      })() && (
        <div className="absolute inset-0 bg-gray-900 flex items-center justify-center z-0">
          <div className="text-center">
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-br from-blue-600 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-2 shadow-lg">
              <span className="text-xl sm:text-2xl text-white font-semibold">
                {userName.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="text-white text-xs sm:text-sm px-2 truncate max-w-full font-medium">
              {userName}
              {(!stream && isLocal && (!videoRef || !videoRef.current?.srcObject)) && (
                <div className="text-[10px] text-gray-400 mt-1">No camera</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;
