/**
 * Runs in instagram.com's own JavaScript world at document_start (registered only while
 * Instagram is connected). Forwards saved-feed pages and save requests to the isolated
 * content script.
 */
import { installNetworkTap } from '../tap';
import { INSTAGRAM_TAP_TAG, instagramOperation } from './constants';

installNetworkTap(INSTAGRAM_TAP_TAG, instagramOperation);
