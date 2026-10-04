/**
 * Runs in a connected site's own JavaScript world at document_start. Gated: it holds what
 * the page loads until the content script says whether this page matters (e.g. it is the
 * saved list), so ordinary browsing on the site is left alone.
 */
import { installNetworkTap } from '../tap';
import { requestShape, SITE_TAP_TAG } from './constants';

installNetworkTap(SITE_TAP_TAG, requestShape, { gated: true });
