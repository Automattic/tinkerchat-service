import { ok, equal, deepEqual } from 'assert';
import { merge } from 'ramda';
import { createStore, compose, applyMiddleware } from 'redux';
import mockio from '../mock-io';
import enhancer from 'state';
import broadcast from 'broadcast';
import { reducer } from 'service';
import { setClientCapacity } from '../integration/helpers';
import WatchingMiddleware from '../mock-middleware';

import {
	AUTOCLOSE_CHAT,
	ASSIGN_CHAT,
	CUSTOMER_LEFT,
	CLOSE_CHAT,
	OPERATOR_RECEIVE_MESSAGE,
	SET_OPERATOR_CHATS_ABANDONED,
	SET_CHAT_MISSED,
	SET_CHATS_RECOVERED,
	NOTIFY_CHAT_STATUS_CHANGED,
	SET_CHAT_OPERATOR,
	OPERATOR_CHAT_TRANSFER
} from 'state/action-types';
import {
	customerInboundMessage,
	customerJoin,
	customerDisconnect
} from 'state/chatlist/actions';
import { STATUS_CLOSED } from 'state/chatlist/reducer';
import { getChatStatus, getChatOperator } from 'state/chatlist/selectors';

const debug = require( 'debug' )( 'happychat:chatlist:test' );

describe( 'ChatList component', () => {
	let store;
	let watchingMiddleware;
	let io;
	let auth = () => Promise.reject( new Error( 'no user' ) );
	const doAuth = () => auth();

	const watchForType = ( ... args ) => watchingMiddleware.watchForType( ... args );
	const watchForTypeOnce = ( ... args ) => watchingMiddleware.watchForTypeOnce( ... args );

	const emitCustomerMessage = ( text = 'hello', id = 'chat-id' ) => {
		store.dispatch( customerInboundMessage( { id }, { text } ) );
	};

	const chatlistWithState = ( state ) => {
		( { server: io } = mockio() );
		watchingMiddleware = new WatchingMiddleware();
		store = createStore( reducer, state, compose(
			enhancer( {
				operatorAuth: doAuth,
				io,
				timeout: 100
			} ),
			applyMiddleware( watchingMiddleware.middleware() )
		) );
		broadcast( store, io.of( '/operator' ) );
	};

	beforeEach( () => {
		chatlistWithState();
	} );

	const connectOperator = ( operator, capacity = 1, status = 'available' ) => new Promise( resolve => {
		// have an operator join
		auth = () => Promise.resolve( merge( operator, { capacity, status } ) );
		const operator_io = io.of( '/operator' );
		const { client, socket } = operator_io.connectNewClient( undefined, () => {
			client.once( 'init', ( user ) => {
				debug( 'init user', user );
				setClientCapacity( client, capacity, status )
				.then( () => resolve( { client, socket } ) );
			} );
		} );
	} );

	it( 'should notify when new chat has started', ( done ) => {
		watchForTypeOnce( NOTIFY_CHAT_STATUS_CHANGED, ( { status, chat_id } ) => {
			equal( status, 'pending' );
			equal( chat_id, 'chat-id' );
			debug( 'first status check' );
			watchForTypeOnce( NOTIFY_CHAT_STATUS_CHANGED, ( { status: status2, lastStatus } ) => {
				equal( status2, 'assigning' );
				equal( lastStatus, 'pending' );
				done();
			} );
		} );
		connectOperator( { id: 'op' } ).then( () => emitCustomerMessage() );
	} );

	it( 'should request operator for chat', ( done ) => {
		watchingMiddleware.watchForType( ASSIGN_CHAT, () => {
			done();
		} );
		connectOperator( { id: 'op' } ).then( () => emitCustomerMessage() );
	} );

	it( 'should move chat to active when operator found', () =>
		connectOperator( { id: 'awesome' } )
		.then( () => new Promise( resolve => {
			watchingMiddleware.watchForType( 'NOTIFY_CHAT_STATUS_CHANGED', action => {
				if ( action.status === 'assigned' && action.lastStatus === 'assigning' ) {
					resolve();
				}
			} );
			emitCustomerMessage();
		} ) )
	);

	it( 'should send chat event message when operator is found', ( done ) =>
		connectOperator( { id: 'operator-id' } )
		.then( ( { client } ) => {
			client.on( 'chat.message', ( chat, message ) => {
				equal( message.session_id, 'chat-id' );
				equal( message.meta.event_type, 'assigned' );
				equal( message.meta.operator.id, 'operator-id' );
				done();
			} );
			emitCustomerMessage();
		} )
	);

	it.skip( 'should timeout if no operator provided', () =>
		connectOperator( { id: 'ripley' } )
		.then( ( { socket } ) => new Promise( resolve => {
			// Makes socket.join timeout
			socket.join = () => {};
			watchForType( SET_CHAT_MISSED, action => {
				const { error, chat_id: id } = action;
				equal( error.message, 'timeout' );
				equal( id, 'chat-id' );
				resolve();
			} );
			emitCustomerMessage();
		} ) )
	);

	it( 'should ask operators for status when customer joins', ( done ) => {
		chatlistWithState( { chatlist: { 'session-id': [ 'assigned' ] } } );
		const { socket, client } = io.of( '/customer' ).newClient( 'test' );

		socket.join( 'customer/session-id' );
		client.once( 'accept', ( accepted ) => {
			// if a chat is assigned, accept is true
			equal( accepted, true );
			done();
		} );

		store.dispatch( customerJoin( { id: 'session-id' }, { id: 'user-id' } ) );
	} );

	describe( 'with active chat', () => {
		const operator_id = 'operator_id';
		const chat = { id: 'the-id' };
		let client;

		beforeEach( () => {
			// TODO: the operator needs to be authenticated before it can close chats
			chatlistWithState( { chatlist: { 'the-id': [ 'assigned', chat, { id: operator_id }, 1, {} ] } } );
			return connectOperator( { id: operator_id } )
			.then( ( { client: c } ) => {
				client = c;
				return Promise.resolve();
			} );
		} );

		it( 'should store assigned operator', () => {
			equal( getChatOperator( chat.id, store.getState() ).id, operator_id );
		} );

		it( 'should send message from customer', done => {
			client.once( 'chat.message', ( _chat, message ) => {
				deepEqual( _chat, chat );
				deepEqual( message, { text: 'hola mundo', source: 'customer' } );
				done();
			} );
			emitCustomerMessage( 'hola mundo', 'the-id' );
		} );

		it( 'should mark chats as abandoned when operator is completely disconnected', ( done ) => {
			watchingMiddleware.watchForType( SET_OPERATOR_CHATS_ABANDONED, () => {
				equal( getChatStatus( 'the-id', store.getState() ), 'abandoned' );
				done();
			}, true );
			client.disconnect();
		} );

		it( 'should allow operator to close chat', ( done ) => {
			watchingMiddleware.watchForType( CLOSE_CHAT, ( action ) => {
				equal( action.operator.id, operator_id );
				equal( action.chat_id, chat.id );
				equal( getChatStatus( chat.id, store.getState() ), STATUS_CLOSED );
				done();
			}, true );
			setImmediate( () => client.emit( 'chat.close', 'the-id' ) );
		} );

		it( 'should request chat transfer', ( done ) => {
			watchingMiddleware.watchForType( OPERATOR_CHAT_TRANSFER, ( action ) => setImmediate( () => {
				equal( action.chat_id, 'the-id' );
				equal( action.user.id, operator_id );
				// No operator connected so user is undefined
				equal( action.toUser, undefined );
				done();
			} ) );
			client.emit( 'chat.transfer', chat.id, 'other-user' );
		} );

		it( 'should timeout when transferring chat to unavailable operator', ( done ) => {
			const newOperator = { id: 'new-operator' };
			watchingMiddleware.watchForTypeOnce( SET_CHAT_MISSED, action => {
				equal( action.chat_id, chat.id );
				done();
			} );
			client.emit( 'chat.transfer', chat.id, newOperator.id );
		} );

		it( 'should transfer chat to new operator', () => {
			const newOperator = { id: 'new-operator' };
			return connectOperator( newOperator )
			.then( () => new Promise( resolve => {
				watchingMiddleware.watchForType( OPERATOR_CHAT_TRANSFER, action => {
					equal( action.chat_id, chat.id );
					equal( action.user.id, operator_id );
					equal( action.toUserId, newOperator.id );
					resolve();
				} );
				client.emit( 'chat.transfer', chat.id, newOperator.id );
			} ) );
		} );

		it( 'should log message when chat is transferred', done => {
			const newOperator = { id: 'new-operator' };
			return connectOperator( newOperator ).then( () => {
				watchForType( OPERATOR_RECEIVE_MESSAGE, action => {
					const { id: chat_id, message } = action;
					equal( chat_id, chat.id );
					ok( message.id );
					ok( message.timestamp );
					equal( message.type, 'event' );
					equal( message.text, 'chat transferred' );
					deepEqual( message.meta.to.id, newOperator.id );
					deepEqual( message.meta.from.id, operator_id );
					equal( message.meta.event_type, 'transfer' );
					done();
				} );
				client.emit( 'chat.transfer', chat.id, newOperator.id );
			} );
		} );

		it( 'should send message when operator joins', done => {
			const newOperator = { id: 'joining-operator' };
			return connectOperator( newOperator ).then( connection => {
				watchForType( OPERATOR_RECEIVE_MESSAGE, action => {
					const { id: chat_id, message } = action;
					equal( chat_id, chat.id );
					ok( message.id );
					deepEqual( message.meta.operator.id, newOperator.id );
					equal( message.meta.event_type, 'join' );
					done();
				} );
				connection.client.emit( 'chat.join', chat.id );
			} );
		} );

		it( 'should send message when operator leaves', done => {
			watchForType( OPERATOR_RECEIVE_MESSAGE, action => {
				const { id: chat_id, message } = action;
				equal( chat_id, chat.id );
				deepEqual( message.meta.operator.id, operator_id );
				equal( message.meta.event_type, 'leave' );
				ok( message );
				done();
			} );
			client.emit( 'chat.leave', chat.id );
		} );

		it( 'should send a message when operator closes chat', done => {
			watchForType( OPERATOR_RECEIVE_MESSAGE, action => {
				const { id: chat_id, message } = action;
				deepEqual( chat_id, chat.id );
				equal( message.type, 'event' );
				equal( message.meta.by.id, operator_id );
				equal( message.meta.event_type, 'close' );
				done();
			} );
			client.emit( 'chat.close', chat.id );
		} );
	} );

	describe( 'with abandoned chat', () => {
		it( 'should reassign operator and make chats active', ( done ) => {
			const operator_id = 'operator-id';
			const chat_id = 'chat-id';

			chatlistWithState( { chatlist:
				{ 'chat-id': [ 'abandoned', { id: chat_id }, { id: operator_id }, 1, {} ] }
			} );

			watchingMiddleware.watchForType( SET_CHATS_RECOVERED, () => {
				equal( getChatStatus( 'chat-id', store.getState() ), 'assigned' );
				equal( getChatOperator( 'chat-id', store.getState() ).id, operator_id );
				done();
			}, true );
			connectOperator( { id: operator_id } );
		} );
	} );

	describe( 'with customer disconnect', () => {
		const operator_id = 'operator-id';
		const chat_id = 'chat-id';
		const user = { id: 'user-id' };
		const chat = { id: chat_id };
		const operator = { id: operator_id };

		beforeEach( () => {
			chatlistWithState( { chatlist: { [ chat_id ]: [ 'assigned', chat, operator, 1, {} ] } } );
		} );

		it( 'should send a message when customer disconnects', ( done ) => {
			watchForType( CUSTOMER_LEFT, () => {
				watchForTypeOnce( OPERATOR_RECEIVE_MESSAGE, action => {
					const { id, message } = action;
					equal( id, chat.id );
					equal( message.type, 'event' );
					equal( message.meta.event_type, 'customer-leave' );
					done();
				} );
			} );

			store.dispatch( customerDisconnect( chat, user ) );
		} );

		it( 'should autoclose chat after specified time', done => {
			watchForType( AUTOCLOSE_CHAT, () => {
				done();
			} );
			store.dispatch( customerDisconnect( chat, user ) );
		} );

		it( 'should revert back to assigned when customer disconnects and returns', ( done ) => {
			watchForType( NOTIFY_CHAT_STATUS_CHANGED, action => {
				// wait until we get a disconnect
				if ( action.status !== 'customer-disconnect' ) {
					return;
				}
				equal( action.status, 'customer-disconnect' );
				deepEqual( action.chat_id, chat.id );

				watchForType( NOTIFY_CHAT_STATUS_CHANGED, action2 => {
					debug( 'status changed', action );
					equal( action2.status, 'assigned' );
					equal( action2.chat_id, chat.id );
					done();
				} );

				watchForType( OPERATOR_RECEIVE_MESSAGE, action3 => {
					const { message } = action3;
					if ( message.meta.event_type === 'customer-leave' ) {
						done( new Error( 'operator should not be sent a message' ) );
					}
				} );

				// small amount of timeout to double-check the message isn't sent
				// immediately
				setTimeout( () => {
					store.dispatch( customerJoin(
						chat,
						{ id: user.id, socket_id: 'socket-id', session_id: 'session-id' }
					) );
				}, 40 );
			} );

			store.dispatch( customerDisconnect( chat, user ) );
		} );
	} );

	it( 'should resasign closed chat to previous operator', done => {
		chatlistWithState( {
			operators: { identities: { opid: { id: 'opid', online: true, status: 'available' } } },
			chatlist: { id: [ STATUS_CLOSED, { id: 'id' }, { id: 'opid' }, null, {} ] }
		} );
		watchForType( SET_CHAT_OPERATOR, () => {
			done();
		} );
		store.dispatch( customerInboundMessage( { id: 'id' }, { id: '123', text: 'hello' } ) );
	} );
} );
