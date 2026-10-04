/**
 * Runs in x.com's own JavaScript world at document_start (registered only while X is
 * connected). Forwards X's GraphQL responses to the isolated content script.
 */
import { installNetworkTap } from '../tap';
import { graphqlOperation, X_TAP_TAG } from './constants';

installNetworkTap(X_TAP_TAG, graphqlOperation);
