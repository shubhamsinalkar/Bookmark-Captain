/**
 * Runs in youtube.com's own JavaScript world at document_start (registered only while
 * YouTube is connected). Forwards InnerTube responses to the isolated content script, plus
 * the first page of a full page load, which YouTube embeds in the HTML as `ytInitialData`.
 */
import { installNetworkTap, TAP_MESSAGE_KEY, type TapMessage } from '../tap';
import { YOUTUBE_TAP_TAG, youtubeOperation } from './constants';

installNetworkTap(YOUTUBE_TAP_TAG, youtubeOperation);

document.addEventListener('DOMContentLoaded', () => {
  const json = (window as { ytInitialData?: unknown }).ytInitialData;
  if (json === undefined) return;
  const message: TapMessage = {
    [TAP_MESSAGE_KEY]: YOUTUBE_TAP_TAG,
    op: 'initial',
    status: 200,
    json,
  };
  window.postMessage(message, window.location.origin);
});
