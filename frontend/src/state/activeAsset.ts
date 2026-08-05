/**
 * The NCEI-shaped view of the active subject.
 *
 * This module used to *be* the cross-panel bridge. It now sits on top of
 * `activeSubject`, which widened the subject from "an NCEI raw file" to "the
 * artifact the right dock is describing", so that a combined store selected in
 * the Derived panel can reach the Metadata panel at all.
 *
 * It is kept, rather than deleted and its four callers rewritten, because
 * `AssetMetadata` is a real and distinct thing: catalogue metadata that only
 * NCEI has. A pipeline's injected input wants a URI and works for any subject;
 * the vessel, survey and channel list want NCEI and are honestly absent
 * otherwise. Returning null for a store is the correct answer to "which NCEI
 * file is selected" — not a gap to paper over.
 *
 * New code that wants "whatever is selected" should read `useActiveSubject`.
 */

import { useActiveSubject } from './activeSubject';

export type { AssetMetadata } from './activeSubject';
export { setActiveAsset } from './activeSubject';

/** The active subject when it is an NCEI file, otherwise null. */
export function useActiveAsset() {
  return useActiveSubject()?.asset ?? null;
}
