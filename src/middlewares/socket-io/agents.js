import { onConnection } from '../../util'
import { getChats } from '../../chat-list/selectors'
import { selectIdentities } from '../../operator/selectors'
import { agentInboundMessage, AGENT_RECEIVE_MESSAGE } from '../../chat-list/actions'

const debug = require( 'debug' )( 'happychat:agent' )

const onAuthorized = ( { socket, getState, dispatch } ) => ( agent ) => {
	// any message sent from a customer needs to be forwarded to the agent socket
	/**
`message`: A message being sent and the context of the message
  - `id`: the id of the message
  - `chat_id`: the conversation this message is for
  - `timestamp`: timestampe of the message
  - `text`: content of the message
  - `context`: the id of the channel the message was sent to
  - `author_id`: the id of the author of the message
  - `author_type`: One of `customer`, `support`, `agent`
	 */
	socket.on( 'message', ( message ) => {
		// TODO: validate message
		debug( 'received message', message )
		// events.emit( 'message', message )
		dispatch( agentInboundMessage( agent, message ) )
	} )

	socket.on( 'system.info', done => {
		const operators = selectIdentities( getState() );
		const chats = getChats( getState() );
		done( { chats, operators } )
	} )

	socket.on( 'role.add', ( role, done ) => {
		debug( 'agent joining role', role )
		socket.join( role, e => {
			if ( e ) {
				return debug( 'failed to add agent role', role, e )
			}
			done()
		} )
	} )

	socket.emit( 'init', agent )
}

export default ( io, events ) => ( { dispatch, getState } ) => {
	io.on( 'connection', ( socket ) => {
		debug( 'agent connection' )
		onConnection(
			{ socket, events },
			onAuthorized( { socket, dispatch, getState } )
		)
	} )
	// agents.on( 'receive', ( message ) => io.emit( 'message', message ) )
	return next => action => {
		switch ( action.type ) {
			case AGENT_RECEIVE_MESSAGE:
				io.emit( 'message', action.message )
				break;
		}
		return next( action )
	}
}
