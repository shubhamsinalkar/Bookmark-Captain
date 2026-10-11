/**
 * Runs in linkedin.com's own JavaScript world at document_start (registered only while
 * LinkedIn is connected). Forwards saved-list pages, save requests and feed responses to the
 * isolated content script.
 */
import { installNetworkTap } from '../tap';
import { LINKEDIN_TAP_TAG, linkedinOperation } from './constants';

installNetworkTap(LINKEDIN_TAP_TAG, linkedinOperation);
