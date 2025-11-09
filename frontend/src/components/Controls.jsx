const Controls = ({
  audioEnabled,
  videoEnabled,
  screenSharing,
  signLanguageEnabled,
  onToggleAudio,
  onToggleVideo,
  onScreenShare,
  onToggleSignLanguage,
  onLeave
}) => {
  return (
    <div className="flex items-center justify-center gap-3 sm:gap-3 md:gap-4 order-1 sm:order-2 w-full sm:w-auto">
      <button
        onClick={onToggleAudio}
        className={`p-3 sm:p-3 rounded-full transition-colors touch-manipulation shadow-lg ${
          audioEnabled
            ? 'bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-white'
            : 'bg-red-600 hover:bg-red-700 active:bg-red-800 text-white'
        }`}
        aria-label={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
        title={audioEnabled ? 'Mute' : 'Unmute'}
      >
        {audioEnabled ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6 sm:h-6 sm:w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
            />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6 sm:h-6 sm:w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
            />
          </svg>
        )}
      </button>

      <button
        onClick={onToggleVideo}
        className={`p-3 sm:p-3 rounded-full transition-colors touch-manipulation shadow-lg ${
          videoEnabled
            ? 'bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-white'
            : 'bg-red-600 hover:bg-red-700 active:bg-red-800 text-white'
        }`}
        aria-label={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
        title={videoEnabled ? 'Stop video' : 'Start video'}
      >
        {videoEnabled ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6 sm:h-6 sm:w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6 sm:h-6 sm:w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
            />
          </svg>
        )}
      </button>

      <button
        onClick={onScreenShare}
        className={`p-3 sm:p-3 rounded-full transition-colors touch-manipulation shadow-lg ${
          screenSharing
            ? 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white'
            : 'bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-white'
        }`}
        aria-label={screenSharing ? 'Stop sharing' : 'Share screen'}
        title={screenSharing ? 'Stop sharing' : 'Share screen'}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 sm:h-6 sm:w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      </button>

      <button
        onClick={onToggleSignLanguage}
        className={`p-3 sm:p-3 rounded-full transition-colors touch-manipulation shadow-lg ${
          signLanguageEnabled
            ? 'bg-green-600 hover:bg-green-700 active:bg-green-800 text-white'
            : 'bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-white'
        }`}
        aria-label={signLanguageEnabled ? 'Disable sign language' : 'Enable sign language'}
        title={signLanguageEnabled ? 'Disable sign language recognition' : 'Enable sign language recognition'}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 sm:h-6 sm:w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 9h6m-3 3v6"
          />
        </svg>
      </button>

      <button
        onClick={onLeave}
        className="p-3 sm:p-3 rounded-full bg-red-600 hover:bg-red-700 active:bg-red-800 text-white transition-colors touch-manipulation shadow-lg"
        aria-label="Leave meeting"
        title="Leave meeting"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 sm:h-6 sm:w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M16 8l-8 8m0-8l8 8"
          />
        </svg>
      </button>
    </div>
  );
};

export default Controls;
