/**
 * Runs in reddit.com's own JavaScript world at document_start (registered only while Reddit
 * is connected). Forwards the responses to save requests to the isolated content script.
 */
import { installNetworkTap } from '../tap';
import { REDDIT_TAP_TAG, redditOperation } from './constants';

installNetworkTap(REDDIT_TAP_TAG, redditOperation);
