import { useActiveSubject } from './activeSubject';

/**
 * What a pipeline is given as its input: the selected product, by URI.
 *
 * A product in the bucket (one Prepare EchoData just made, or one picked in
 * Derived) is a gs:// EchoData or Sv, which every aa-* tool reads directly.
 * Raw NCEI files are not selected one at a time any more: Prepare EchoData
 * turns a time range of them into a product, and pipelines start from that.
 * With nothing usable selected, a pipeline's input field is typed by hand.
 *
 * The Pipelines and Configuration panels both read this, so the run controls
 * and the settings can never disagree about what a run would be given.
 */
export interface PipelineInput {
  /** The value injected into each pipeline's input parameter. */
  value: string;
  /** Where it came from, for the run controls' caption. */
  source: string;
}

export function usePipelineInput(): PipelineInput | null {
  const subject = useActiveSubject();
  if (!subject || !/^gs:\/\/.+\.(nc|zarr)\/?$/i.test(subject.uri)) return null;
  return { value: subject.uri, source: subject.origin };
}
