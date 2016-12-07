import { equal, deepEqual } from 'assert'
import { EventEmitter } from 'events'
import { createStore } from 'redux'
import enhancer from 'state'
import { reducer } from 'service'
import mockio from '../mock-io'
import WatchingMiddleware from '../mock-middleware'
import {
	AGENT_RECEIVE_MESSAGE,
	OPERATOR_RECEIVE_MESSAGE,
	CUSTOMER_RECEIVE_TYPING,
	CUSTOMER_RECEIVE_MESSAGE,
	CUSTOMER_JOIN,
	CUSTOMER_DISCONNECT,
	agentInboundMessage,
	customerInboundMessage,
	operatorInboundMessage,
	customerTyping,
	customerJoin,
	customerDisconnect
} from 'state/chatlist/actions';
import {
	OPERATOR_RECEIVE_TYPING,
	updateIdentity,
	operatorTyping
} from 'state/operator/actions';

describe( 'Controller', () => {
	let store, watchingMiddleware, io

	const watchForType = ( ... args ) => watchingMiddleware.watchForType( ... args )

	beforeEach( () => {
		io = mockio().server
		watchingMiddleware = new WatchingMiddleware()
		store = createStore( reducer, enhancer( {
			io,
			customerAuth: () => Promise.resolve( 'customer' ),
			agentAuth: () => Promise.resolve( 'agent' ),
			operatorAuth: () => Promise.resolve( 'operator' ),
			middlewares: [ watchingMiddleware.middleware() ]
		} ) )
	} )

	const mockUser = { id: 'user-id', displayName: 'Furiosa' }
	const socketIdentifier = { id: mockUser.id, socketId: mockUser.id }

	describe( 'with user', () => {
		it( 'notifies agent when user joins', ( done ) => {
			watchForType( CUSTOMER_JOIN, action => {
				const { chat: { id, displayName }, user: { id: user_id, socketId } } = action
				equal( id, 'user-id' )
				equal( socketId, 'user-id' )
				equal( user_id, 'user-id' )
				equal( displayName, 'Furiosa' )
				done()
			} )
			store.dispatch( customerJoin( new EventEmitter(), mockUser, socketIdentifier ) )
		} )

		it( 'notifies agent when user disconnects', ( done ) => {
			watchForType( CUSTOMER_DISCONNECT, action => {
				const { chat, user } = action
				equal( chat.id, 'chat-id' )
				equal( user.id, 'user-id' )
				equal( user.displayName, 'Furiosa' )
				done()
			} )
			store.dispatch( customerDisconnect( { id: 'chat-id' }, mockUser ) )
		} )
	} )

	describe( 'customer message', () => {
		it( 'should notify customers', ( done ) => {
			watchForType( CUSTOMER_RECEIVE_MESSAGE, action => {
				const { message: { id, session_id, text } } = action
				equal( id, 'message-id' )
				equal( text, 'hello' )
				equal( session_id, 'user-id' )
				done()
			} )
			store.dispatch( customerInboundMessage(
				{ id: 'user-id' },
				{ session_id: 'user-id', id: 'message-id', text: 'hello', timestamp: 12345 }
			) )
		} )

		it( 'should notify agents', ( done ) => {
			watchForType( AGENT_RECEIVE_MESSAGE, action => {
				const { id, timestamp, session_id, text, author_id, author_type } = action.message
				equal( id, 'message-id' )
				equal( timestamp, 12345 )
				equal( author_type, 'customer' )
				equal( session_id, 'user-id' )
				equal( author_id, 'user-id' )
				equal( text, 'hello' )
				done()
			} )
			store.dispatch( customerInboundMessage(
				{ id: 'user-id' },
				{ session_id: 'user-id', id: 'message-id', text: 'hello', timestamp: 12345 }
			) )
		} )

		it( 'should notify operators', ( done ) => {
			watchingMiddleware.watchForType( OPERATOR_RECEIVE_MESSAGE, ( action ) => {
				equal( action.message.id, 'message-id' )
				equal( action.message.session_id, 'user-id' )
				equal( action.message.text, 'hello' )
				done()
			} )

			store.dispatch( customerInboundMessage(
				{ id: 'user-id' },
				{ session_id: 'user-id', id: 'message-id', text: 'hello', timestamp: 12345 }
			) )
		} )
	} )

	describe( 'agent message', () => {
		it( 'should notify agents', ( done ) => {
			watchForType( AGENT_RECEIVE_MESSAGE, action => {
				const { author_type, id, session_id, timestamp, author_id } = action.message
				equal( author_type, 'agent' )
				equal( author_id, 'author' )
				equal( id, 'message-id' )
				equal( session_id, 'chat-id' )
				equal( timestamp, 12345 )
				done()
			} )
			store.dispatch( agentInboundMessage( 'agent',
				{ id: 'message-id', session_id: 'chat-id', timestamp: 12345, author_id: 'author' }
			) )
		} )

		it( 'should notify customers', ( done ) => {
			//   - `id`: the id of the message
			// - `timestamp`: timestampe of the message
			// - `text`: content of the message
			// - `context`: the id of the channel the message was sent to
			// - `author_id`: the id of the author of the message
			// - `author_type`: One of `customer`, `support`, `agent`
			watchForType( CUSTOMER_RECEIVE_MESSAGE, action => {
				const { message: { author_type, id, session_id, timestamp, author_id } } = action
				equal( author_type, 'agent' )
				equal( author_id, 'author' )
				equal( id, 'message-id' )
				equal( session_id, 'chat-id' )
				equal( timestamp, 12345 )
				done()
			} )
			store.dispatch( agentInboundMessage( 'agent',
				{ id: 'message-id', session_id: 'chat-id', timestamp: 12345, author_id: 'author' }
			) )
		} )

		it( 'should notify operators', ( done ) => {
			watchForType( CUSTOMER_RECEIVE_MESSAGE, action => {
				const { message: { author_type, id, session_id, timestamp, author_id } } = action
				equal( author_type, 'agent' )
				equal( author_id, 'author' )
				equal( id, 'message-id' )
				equal( session_id, 'chat-id' )
				equal( timestamp, 12345 )
				done()
			} )
			store.dispatch( agentInboundMessage( 'agent',
				{ id: 'message-id', session_id: 'chat-id', timestamp: 12345, author_id: 'author' }
			) )
		} )
	} )

	describe( 'operator message', () => {
		it( 'should notify operators', ( done ) => {
			watchingMiddleware.watchForAction( {
				type: OPERATOR_RECEIVE_MESSAGE,
				id: 'chat-id',
				message: { id: 'message-id' }
			}, () => done() );

			store.dispatch( operatorInboundMessage(
				'chat-id', mockUser, { id: 'message-id', user: mockUser }
			) )
		} )

		it( 'should notify agents', ( done ) => {
			watchForType( AGENT_RECEIVE_MESSAGE, ( action ) => {
				const { author_type, id, session_id, timestamp, author_id, type } = action.message
				equal( author_type, 'operator' )
				equal( author_id, 'user-id' )
				equal( id, 'message-id' )
				equal( session_id, 'chat-id' )
				equal( timestamp, 12345 )
				equal( type, 'type' )
				done()
			} )
			store.dispatch( operatorInboundMessage(
				'chat-id', mockUser, { id: 'message-id', user: mockUser, timestamp: 12345, type: 'type' }
			) )
		} )

		it( 'should notify customers', ( done ) => {
			watchForType( CUSTOMER_RECEIVE_MESSAGE, action => {
				const { message: { id: message_id }, id } = action
				equal( id, 'chat-id' )
				equal( message_id, 'message-id' )
				done()
			} )
			store.dispatch( operatorInboundMessage(
				'chat-id', mockUser, { id: 'message-id', user: mockUser, timestamp: 12345 }
			) )
		} )
	} )

	describe( 'customer `typing`', () => {
		it( 'should notify operators', ( done ) => {
			watchingMiddleware.watchForType( OPERATOR_RECEIVE_TYPING, ( action ) => {
				equal( action.id, 'chat-id' )
				equal( action.user.id, 'user-id' )
				equal( action.text, 'typing a message...' )
				done()
			} )

			store.dispatch( customerTyping( 'chat-id', { id: 'user-id'}, 'typing a message...' ) )
		} )
	} )

	describe( 'operator `typing`', () => {
		it( 'should notify operators', ( done ) => {
			watchingMiddleware.watchForType( OPERATOR_RECEIVE_TYPING, ( action ) => {
				equal( action.id, 'chat-id' )
				equal( action.user.id, 'user-id' )
				equal( action.text, 'typing a message...' )
				done()
			} )

			store.dispatch( operatorTyping( 'chat-id', { id: 'user-id' }, 'typing a message...' ) )
		} )

		it( 'should notify customers', ( done ) => {
			watchingMiddleware.watchForType( CUSTOMER_RECEIVE_TYPING, action => {
				const { id, user, text } = action
				equal( id, 'chat-id' )
				equal( user.id, 'user-id' )
				equal( text, 'typing a message...' )
				done()
			} )

			store.dispatch( operatorTyping( 'chat-id', { id: 'user-id' }, 'typing a message...' ) )
		} )
	} )

	describe( 'agents system.info', () => {
		it( 'should handle system.info event', done => {
			// need to insert operator
			store.dispatch( updateIdentity( { id: 'what' }, { id: 'operator' } ) )
			// authenticate an agent client
			const { client } = io.of( '/agent' ).newClient()
			client.on( 'init', () => {
				client.emit( 'system.info', data => {
					deepEqual( data.chats, [] )
					deepEqual( data.operators, [ { id: 'operator', load: 0, capacity: 3, online: false } ] )
					done()
				} )
			} ).connect()
		} )
	} )
} )
