import { ok, deepEqual, equal } from 'assert';
import makeService, { authenticators } from './helpers';
import { STATUS_CLOSED, STATUS_PENDING } from 'state/chatlist/reducer';
import { getChatStatus } from 'state/chatlist/selectors';

const debug = require( 'debug' )( 'happychat:test:join-chat' );

describe( 'Operator', () => {
	const mockUser = {
		id: 'fake-user-id',
		displayName: 'Nasuicaä',
		username: 'nausicaa',
		picture: 'http://example.com/nausicaa',
		session_id: 'session-id'
	};

	const opUser = {
		id: 'operator-id',
		displayName: 'Ridley',
		username: 'ridley',
		picture: 'http://sample.com/ridley'
	};

	let service;

	const emitCustomerMessage = ( { customer, operator } ) => new Promise( ( resolve ) => {
		customer.on( 'message', message => {
			debug( 'customer received message', message.id );
			resolve( { customer, operator } );
		} );
		customer.emit( 'message', { id: 'message', text: 'hello' } );
	} );

	const operatorJoinChat = ( { operator } ) => new Promise( ( resolve ) => {
		debug( 'operator is joining chat' );
		operator.on( 'chat.open', ( chat ) => {
			resolve( chat );
		} );
		operator.emit( 'chat.join', mockUser.session_id );
	} );

	const leaveChat = ( client, chat_id ) => new Promise( ( resolve ) => {
		client.once( 'chat.leave', ( chat ) => resolve( { client, chat } ) );
		client.emit( 'chat.leave', chat_id );
	} );

	const closeChat = ( client, chat_id ) => new Promise( resolve => {
		client.once( 'chat.close', chat => resolve( chat ) );
		client.emit( 'chat.close', chat_id );
	} );

	const requestState = client => new Promise( resolve => {
		debug( 'requesting state' );
		client.once( 'broadcast.state', ( version, state ) => {
			debug( 'received state' );
			resolve( state );
		} );
		client.emit( 'broadcast.state' );
	} );

	beforeEach( () => {
		service = makeService( authenticators( mockUser, opUser, {} ) );
		service.start();
	} );
	afterEach( () => service.stop() );

	it( 'should join chat', () => service.startClients()
		.then( emitCustomerMessage )
		.then( operatorJoinChat )
		.then( chat => {
			ok( chat );
		} )
	);

	describe( 'when in a chat', () => {
		let operator;

		beforeEach( () => service.startClients()
			.then( ( clients ) => {
				operator = clients.operator;
				return Promise.resolve( clients );
			} )
			.then( emitCustomerMessage )
			.then( operatorJoinChat )
		);

		it( 'should leave chat', () => leaveChat( operator, mockUser.session_id )
			.then( ( { chat: { id } } ) => {
				deepEqual( id, mockUser.session_id );
			} )
		);

		it( 'should close chat', () => {
			equal( getChatStatus( 'session-id', service.getState() ), STATUS_PENDING );
			closeChat( operator, mockUser.session_id );
			return requestState( operator )
				.then( () => {
					equal( service.getState().chatlist[ 'session-id' ][ 0 ], STATUS_CLOSED );
				} );
		} );
	} );
} );
