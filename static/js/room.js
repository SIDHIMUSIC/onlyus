from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import os
import uuid
from datetime import datetime
from pymongo import MongoClient

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'onlyus-bubudubu-secret-key-2026')
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

MAX_USERS = 10

MONGO_URI = os.environ.get('MONGO_URI')
db = None
messages_col = None

if MONGO_URI:
    try:
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        client.admin.command('ping')
        db = client['onlyus']
        messages_col = db['messages']
        print("✅ MongoDB Connected Successfully")
    except Exception as e:
        print("❌ MongoDB Connection Failed:", e)
        db = None
else:
    print("⚠️ MONGO_URI not found - using in-memory only")

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
            'notes': '',
            'todos': [],
            'last_seen': {},
            'created_at': datetime.utcnow().isoformat()
        }
    room = rooms[room_id]
    room.setdefault('notes', '')
    room.setdefault('todos', [])
    room.setdefault('last_seen', {})
    room.setdefault('moods', {})
    return room


def save_message_to_db(room_id, msg):
    if messages_col is not None:
        try:
            messages_col.insert_one({
                'room_id': room_id,
                'id': msg['id'],
                'name': msg['name'],
                'avatar': msg.get('avatar', '👤'),
                'message': msg['message'],
                'time': msg['time'],
                'created_at': datetime.utcnow()
            })
        except Exception as e:
            print("Error saving message:", e)


def load_messages_from_db(room_id, limit=80):
    if messages_col is None:
        return []
    try:
        cursor = messages_col.find({'room_id': room_id}).sort('created_at', -1).limit(limit)
        messages = list(cursor)
        messages.reverse()
        return [{
            'id': m.get('id', ''),
            'name': m.get('name', 'Anonymous'),
            'avatar': m.get('avatar', '👤'),
            'message': m.get('message', ''),
            'time': m.get('time', '')
        } for m in messages]
    except Exception as e:
        print("Error loading messages:", e)
        return []


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
    for room_id, room in list(rooms.items()):
        if request.sid in room['users']:
            username = room['users'][request.sid]['name']
            del room['users'][request.sid]
            leave_room(room_id)
            emit('user_left', {
                'sid': request.sid,
                'name': username,
                'users': list(room['users'].values()),
                'max_users': MAX_USERS,
                'last_seen': room.get('last_seen', {}),
                'moods': room.get('moods', {})
            }, room=room_id)
            print(f"{username} left room {room_id}")
            break


@socketio.on('join_room')
def handle_join(data):
    room_id = data.get('room_id', 'onlyus')
    username = data.get('username', 'Anonymous')
    avatar = data.get('avatar', '👤')

    room = get_or_create_room(room_id)

    if request.sid not in room['users']:
        if len(room['users']) >= MAX_USERS:
            emit('room_full', {'max': MAX_USERS, 'count': len(room['users'])})
            return

    join_room(room_id)
    room['users'][request.sid] = {
        'sid': request.sid,
        'name': username,
        'avatar': avatar,
        'joined_at': datetime.utcnow().isoformat()
    }
    room['last_seen'][username] = datetime.utcnow().isoformat()

    db_messages = load_messages_from_db(room_id)
    if not db_messages:
        db_messages = room['messages'][-50:]

    emit('room_state', {
        'users': list(room['users'].values()),
        'player': room['player'],
        'queue': room['queue'],
        'messages': db_messages,
        'moods': room['moods'],
        'notes': room.get('notes', ''),
        'todos': room.get('todos', []),
        'last_seen': room.get('last_seen', {}),
        'max_users': MAX_USERS
    })

    emit('user_joined', {
        'user': room['users'][request.sid],
        'users': list(room['users'].values()),
        'max_users': MAX_USERS,
        'last_seen': room.get('last_seen', {}),
        'moods': room.get('moods', {})
    }, room=room_id, include_self=False)

    print(f"{username} joined room {room_id} ({len(room['users'])}/{MAX_USERS})")


@socketio.on('player_action')
def handle_player_action(data):
    room_id = data.get('room_id')
    action = data.get('action')
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
    user = room['users'].get(request.sid, {'name': 'Anonymous', 'avatar': '👤'})

    msg = {
        'id': str(uuid.uuid4()),
        'name': user['name'],
        'avatar': user['avatar'],
        'message': message[:300],
        'time': datetime.utcnow().strftime('%H:%M')
    }

    room['messages'].append(msg)
    if len(room['messages']) > 200:
        room['messages'] = room['messages'][-200:]

    save_message_to_db(room_id, msg)
    emit('new_message', msg, room=room_id)


@socketio.on('send_reaction')
def handle_reaction(data):
    room_id = data.get('room_id')
    reaction = data.get('reaction')
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
        room['last_seen'][user['name']] = datetime.utcnow().isoformat()
        emit('mood_update', {
            'name': user['name'],
            'mood': mood,
            'moods': room['moods'],
            'last_seen': room['last_seen']
        }, room=room_id)


@socketio.on('update_notes')
def handle_notes(data):
    room_id = data.get('room_id')
    text = (data.get('text') or '')[:5000]
    room = get_or_create_room(room_id)
    room['notes'] = text
    emit('notes_sync', {'text': text, 'from_sid': request.sid}, room=room_id)


@socketio.on('todo_add')
def handle_todo_add(data):
    room_id = data.get('room_id')
    text = (data.get('text') or '').strip()[:200]
    if not text:
        return
    room = get_or_create_room(room_id)
    item = {'id': str(uuid.uuid4()), 'text': text, 'done': False}
    room['todos'].append(item)
    if len(room['todos']) > 50:
        room['todos'] = room['todos'][-50:]
    emit('todos_sync', {'todos': room['todos']}, room=room_id)


@socketio.on('todo_toggle')
def handle_todo_toggle(data):
    room_id = data.get('room_id')
    todo_id = data.get('id')
    room = get_or_create_room(room_id)
    for t in room['todos']:
        if t['id'] == todo_id:
            t['done'] = not t['done']
            break
    emit('todos_sync', {'todos': room['todos']}, room=room_id)


@socketio.on('todo_delete')
def handle_todo_delete(data):
    room_id = data.get('room_id')
    todo_id = data.get('id')
    room = get_or_create_room(room_id)
    room['todos'] = [t for t in room['todos'] if t['id'] != todo_id]
    emit('todos_sync', {'todos': room['todos']}, room=room_id)


@socketio.on('heartbeat')
def handle_heartbeat(data):
    room_id = data.get('room_id')
    room = get_or_create_room(room_id)
    user = room['users'].get(request.sid)
    if user:
        room['last_seen'][user['name']] = datetime.utcnow().isoformat()
        emit('last_seen_sync', {
            'last_seen': room['last_seen'],
            'users': list(room['users'].values()),
            'moods': room.get('moods', {})
        }, room=room_id)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port, debug=False, allow_unsafe_werkzeug=True)
