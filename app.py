from flask import Flask, render_template, request, session, redirect, url_for
from flask_socketio import SocketIO, emit, join_room, leave_room
import os
import uuid
from datetime import datetime

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'onlyus-bubudubu-secret-key-2026')
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# In-memory room state (for MVP - later can move to Redis/DB)
rooms = {}

def get_or_create_room(room_id):
    if room_id not in rooms:
        rooms[room_id] = {
            'users': {},
            'player': {
                'video_id': None,
                'title': None,
                'is_playing': False,
                'current_time': 0,
                'last_update': None
            },
            'queue': [],
            'messages': [],
            'moods': {},
            'created_at': datetime.utcnow().isoformat()
        }
    return rooms[room_id]


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/room/<room_id>')
def room(room_id):
    username = request.args.get('name', 'Anonymous')
    return render_template('room.html', room_id=room_id, username=username)


@socketio.on('connect')
def handle_connect():
    print(f"Client connected: {request.sid}")


@socketio.on('disconnect')
def handle_disconnect():
    # Remove user from any room
    for room_id, room in list(rooms.items()):
        if request.sid in room['users']:
            username = room['users'][request.sid]['name']
            del room['users'][request.sid]
            leave_room(room_id)
            emit('user_left', {
                'sid': request.sid,
                'name': username,
                'users': list(room['users'].values())
            }, room=room_id)
            print(f"{username} left room {room_id}")
            break


@socketio.on('join_room')
def handle_join(data):
    room_id = data.get('room_id', 'onlyus')
    username = data.get('username', 'Anonymous')
    avatar = data.get('avatar', '💗')

    join_room(room_id)
    room = get_or_create_room(room_id)

    room['users'][request.sid] = {
        'sid': request.sid,
        'name': username,
        'avatar': avatar,
        'joined_at': datetime.utcnow().isoformat()
    }

    # Send current state to the new user
    emit('room_state', {
        'users': list(room['users'].values()),
        'player': room['player'],
        'queue': room['queue'],
        'messages': room['messages'][-50:],  # last 50 messages
        'moods': room['moods']
    })

    # Notify others
    emit('user_joined', {
        'user': room['users'][request.sid],
        'users': list(room['users'].values())
    }, room=room_id, include_self=False)

    print(f"{username} joined room {room_id}")


@socketio.on('player_action')
def handle_player_action(data):
    room_id = data.get('room_id')
    action = data.get('action')  # play, pause, seek, load
    room = get_or_create_room(room_id)

    if action == 'load':
        room['player']['video_id'] = data.get('video_id')
        room['player']['title'] = data.get('title', 'Unknown')
        room['player']['is_playing'] = True
        room['player']['current_time'] = 0
        room['player']['last_update'] = datetime.utcnow().isoformat()
    elif action == 'play':
        room['player']['is_playing'] = True
        room['player']['current_time'] = data.get('current_time', room['player']['current_time'])
        room['player']['last_update'] = datetime.utcnow().isoformat()
    elif action == 'pause':
        room['player']['is_playing'] = False
        room['player']['current_time'] = data.get('current_time', room['player']['current_time'])
        room['player']['last_update'] = datetime.utcnow().isoformat()
    elif action == 'seek':
        room['player']['current_time'] = data.get('current_time', 0)
        room['player']['last_update'] = datetime.utcnow().isoformat()

    # Broadcast to everyone in room (including sender for consistency)
    emit('player_sync', {
        'action': action,
        'video_id': room['player']['video_id'],
        'title': room['player']['title'],
        'is_playing': room['player']['is_playing'],
        'current_time': room['player']['current_time'],
        'from_sid': request.sid
    }, room=room_id)


@socketio.on('chat_message')
def handle_chat(data):
    room_id = data.get('room_id')
    message = data.get('message', '').strip()
    if not message:
        return

    room = get_or_create_room(room_id)
    user = room['users'].get(request.sid, {'name': 'Anonymous', 'avatar': '💗'})

    msg = {
        'id': str(uuid.uuid4()),
        'name': user['name'],
        'avatar': user['avatar'],
        'message': message,
        'time': datetime.utcnow().strftime('%H:%M')
    }
    room['messages'].append(msg)
    # Keep only last 200 messages
    if len(room['messages']) > 200:
        room['messages'] = room['messages'][-200:]

    emit('new_message', msg, room=room_id)


@socketio.on('send_reaction')
def handle_reaction(data):
    room_id = data.get('room_id')
    reaction = data.get('reaction')  # hug, kiss, missyou, heart
    room = get_or_create_room(room_id)
    user = room['users'].get(request.sid, {'name': 'Anonymous'})

    emit('reaction', {
        'from': user['name'],
        'reaction': reaction,
        'sid': request.sid
    }, room=room_id)


@socketio.on('set_mood')
def handle_mood(data):
    room_id = data.get('room_id')
    mood = data.get('mood')
    room = get_or_create_room(room_id)
    user = room['users'].get(request.sid)
    if user:
        room['moods'][user['name']] = mood
        emit('mood_update', {
            'name': user['name'],
            'mood': mood,
            'moods': room['moods']
        }, room=room_id)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port, debug=False, allow_unsafe_werkzeug=True)
