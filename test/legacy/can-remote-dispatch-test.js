import { ok } from 'assert';
import canRemoteDispatch from 'state/operator/can-remote-dispatch';
import { setOperatorCapacity, setAcceptsCustomers, setOperatorStatus } from 'state/operator/actions';

describe( 'Remote Dispatch', () => {
	it( 'can update system accept status', () => {
		ok( canRemoteDispatch( { action: setAcceptsCustomers( true ), user: true } ) );
	} );
	it( 'can set capacity for remote user', () => {
		ok( canRemoteDispatch( {
			action: setOperatorCapacity( 5 ),
			user: true
		} ) );
	} );
	it( 'can set status from remote user', () => {
		ok( canRemoteDispatch( {
			action: setOperatorStatus( 'test' ),
			user: true
		} ) );
	} );
} );
