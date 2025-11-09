import { useState } from 'react';
import HomePage from './components/HomePage';
import MeetingRoom from './components/MeetingRoom';

const App = () => {
  const [roomId, setRoomId] = useState(null);
  const [userName, setUserName] = useState('');

  const handleJoinMeeting = (id, name) => {
    setRoomId(id);
    setUserName(name);
  };

  const handleLeaveMeeting = () => {
    setRoomId(null);
    setUserName('');
  };

  return (
    <div className="h-screen w-full">
      {roomId ? (
        <MeetingRoom 
          roomId={roomId} 
          userName={userName}
          onLeave={handleLeaveMeeting}
        />
      ) : (
        <HomePage onJoinMeeting={handleJoinMeeting} />
      )}
    </div>
  );
};

export default App;
