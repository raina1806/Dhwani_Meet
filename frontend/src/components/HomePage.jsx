import { useState } from 'react';
import { BACKEND_URL } from '../config';

const HomePage = ({ onJoinMeeting }) => {
  const [roomId, setRoomId] = useState('');
  const [userName, setUserName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateMeeting = async () => {
    if (!userName.trim()) {
      alert('Please enter your name');
      return;
    }

    setIsCreating(true);
    try {
      console.log('Creating room via:', `${BACKEND_URL}/api/create-room`);
      const response = await fetch(`${BACKEND_URL}/api/create-room`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.roomId) {
        throw new Error('Invalid response from server: missing roomId');
      }

      onJoinMeeting(data.roomId, userName);
    } catch (error) {
      console.error('Error creating room:', error);
      const errorMessage = error.message || 'Failed to create meeting';
      alert(`Failed to create meeting: ${errorMessage}\n\nMake sure the backend server is running on ${BACKEND_URL}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinRoom = () => {
    if (!roomId.trim() || !userName.trim()) {
      alert('Please enter both room ID and your name');
      return;
    }
    onJoinMeeting(roomId.trim(), userName);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-lg shadow-xl p-4 sm:p-6 md:p-8 w-full max-w-md">
        <div className="text-center mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">Meet Clone</h1>
          <p className="text-sm sm:text-base text-gray-600">Video conferencing made simple</p>
        </div>

        <div className="space-y-3 sm:space-y-4">
          <div>
            <label htmlFor="userName" className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
              Your Name
            </label>
            <input
              id="userName"
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Enter your name"
              className="w-full px-3 sm:px-4 py-2.5 sm:py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none touch-manipulation"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && roomId) {
                  handleJoinRoom();
                } else if (e.key === 'Enter' && !roomId) {
                  handleCreateMeeting();
                }
              }}
            />
          </div>

          <div>
            <label htmlFor="roomId" className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
              Meeting ID (Optional for new meeting)
            </label>
            <input
              id="roomId"
              type="text"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder="Enter meeting ID to join"
              className="w-full px-3 sm:px-4 py-2.5 sm:py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none touch-manipulation"
            />
          </div>

          <div className="flex flex-col gap-2 sm:gap-3 pt-2 sm:pt-4">
            <button
              onClick={handleCreateMeeting}
              disabled={isCreating}
              className="w-full bg-blue-600 text-white py-3 sm:py-3.5 px-4 rounded-lg font-semibold text-sm sm:text-base hover:bg-blue-700 active:bg-blue-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
            >
              {isCreating ? 'Creating...' : 'New Meeting'}
            </button>

            {roomId && (
              <button
                onClick={handleJoinRoom}
                className="w-full bg-green-600 text-white py-3 sm:py-3.5 px-4 rounded-lg font-semibold text-sm sm:text-base hover:bg-green-700 active:bg-green-800 transition-colors touch-manipulation"
              >
                Join Meeting
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default HomePage;
