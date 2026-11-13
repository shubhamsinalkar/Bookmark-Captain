/**
 * Runs in Substack's own JavaScript world at document_start, on substack.com and on every
 * newsletter's *.substack.com site (registered only while Substack is connected). Forwards the
 * answers to save and unsave requests to the isolated content script.
 */
import { installNetworkTap } from '../tap';
import { SUBSTACK_TAP_TAG, substackOperation } from './constants';

installNetworkTap(SUBSTACK_TAP_TAG, substackOperation);
