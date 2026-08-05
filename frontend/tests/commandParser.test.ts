import { describe, expect, it } from 'vitest';

import {
  buildPipeline,
  parseCommand,
  parseSegment,
  splitPipeline,
  templateForSegment,
  tokenize,
} from '../src/components/panels/pipelines/commandParser';
import { COMMAND_OVERRIDE, INPUT_TOKEN } from '../src/components/panels/pipelines/pipelineTypes';

/**
 * Turning typed bash into pipeline stages.
 *
 * Two properties are load-bearing and everything else is detail:
 *
 *  1. **Nothing is silently dropped.** A token the catalogue does not
 *     understand demotes its whole stage to freeform, where the text runs
 *     verbatim. The alternative — keeping the flags we recognised — generates
 *     a command that is not the one the user typed, which is the single worst
 *     thing this feature could do.
 *  2. **Quoting is a value, not source.** A parameter that ends up holding
 *     `"my dir"` with the quotes still attached gets re-quoted on the way out
 *     and reaches the tool as a directory name containing quote marks.
 */

describe('splitPipeline', () => {
  it('splits on pipes', () => {
    expect(splitPipeline('aa-fetch x | aa-raw | aa-combine')).toEqual([
      'aa-fetch x',
      'aa-raw',
      'aa-combine',
    ]);
  });

  it('ignores a pipe inside double quotes', () => {
    expect(splitPipeline('aa-sv f.nc | grep -v "WARN|INFO"')).toEqual([
      'aa-sv f.nc',
      'grep -v "WARN|INFO"',
    ]);
  });

  it('ignores a pipe inside single quotes', () => {
    expect(splitPipeline("awk '{print $1|$2}' x")).toEqual(["awk '{print $1|$2}' x"]);
  });

  it('ignores an escaped pipe', () => {
    expect(splitPipeline('echo a\\|b')).toEqual(['echo a\\|b']);
  });

  it('drops empty segments from stray or trailing pipes', () => {
    expect(splitPipeline('aa-raw |  | aa-combine |')).toEqual(['aa-raw', 'aa-combine']);
  });

  it('returns nothing for an empty command', () => {
    expect(splitPipeline('   ')).toEqual([]);
  });
});

describe('tokenize', () => {
  it('splits on whitespace', () => {
    expect(tokenize('aa-fetch -o /data')).toEqual(['aa-fetch', '-o', '/data']);
  });

  it('strips one level of double quotes', () => {
    expect(tokenize('aa-fetch -o "my dir"')).toEqual(['aa-fetch', '-o', 'my dir']);
  });

  it('strips one level of single quotes', () => {
    expect(tokenize("aa-fetch -o 'my dir'")).toEqual(['aa-fetch', '-o', 'my dir']);
  });

  it('keeps a backslash literal inside single quotes', () => {
    // Single quotes protect a regex or a path; treating \\ as an escape here
    // silently corrupts exactly the values someone quoted to keep intact.
    expect(tokenize("grep '\\d+'")).toEqual(['grep', '\\d+']);
  });

  it('honours an escape inside double quotes', () => {
    expect(tokenize('echo "a\\"b"')).toEqual(['echo', 'a"b']);
  });

  it('keeps an empty quoted argument', () => {
    // `--label ""` passes an empty argument, which is not the same as passing
    // no argument at all.
    expect(tokenize('aa-raw --label ""')).toEqual(['aa-raw', '--label', '']);
  });

  it('joins a quoted run to its adjacent characters', () => {
    expect(tokenize('--out=/data/"my dir"')).toEqual(['--out=/data/my dir']);
  });

  it('collapses runs of whitespace', () => {
    expect(tokenize('  aa-raw    --overwrite  ')).toEqual(['aa-raw', '--overwrite']);
  });
});

describe('parseSegment — recognised tools', () => {
  it('maps a flag and its value', () => {
    const stage = parseSegment('aa-fetch -o /data/downloads');
    expect(stage.structured).toBe(true);
    expect(stage.tool).toBe('aa-fetch');
    expect(stage.values.outputRoot).toBe('/data/downloads');
  });

  it('maps --flag=value the same as --flag value', () => {
    const inline = parseSegment('aa-combine -o=out.zarr');
    const spaced = parseSegment('aa-combine -o out.zarr');
    expect(inline.values.output).toBe('out.zarr');
    expect(spaced.values.output).toBe(inline.values.output);
  });

  it('maps a boolean flag to true without consuming the next token', () => {
    const stage = parseSegment('aa-combine --report -o out.zarr');
    expect(stage.structured).toBe(true);
    expect(stage.values.report).toBe(true);
    expect(stage.values.output).toBe('out.zarr');
  });

  it('splits a multi value on commas', () => {
    const stage = parseSegment('aa-combine --channels "GPT 18 kHz,GPT 38 kHz"');
    expect(stage.values.channels).toEqual(['GPT 18 kHz', 'GPT 38 kHz']);
  });

  it('assigns a positional to the input parameter', () => {
    const stage = parseSegment('aa-fetch /data/survey.raw');
    expect(stage.structured).toBe(true);
    expect(stage.values.input).toBe('/data/survey.raw');
  });

  it('assigns a positional to a target parameter', () => {
    const stage = parseSegment('aa-append existing.zarr --plan');
    expect(stage.structured).toBe(true);
    expect(stage.values.store).toBe('existing.zarr');
    expect(stage.values.plan).toBe(true);
  });

  it('unquotes a value before storing it', () => {
    const stage = parseSegment('aa-fetch -o "/data/Dysons Bank"');
    expect(stage.values.outputRoot).toBe('/data/Dysons Bank');
  });

  it('parses a tool with no arguments', () => {
    const stage = parseSegment('aa-raw');
    expect(stage.structured).toBe(true);
    expect(stage.values).toEqual({});
  });
});

describe('parseSegment — the all-or-nothing rule', () => {
  it('demotes a stage with an unknown flag', () => {
    const stage = parseSegment('aa-combine -o out.zarr --nonexistent 3');
    expect(stage.structured).toBe(false);
    expect(stage.unmapped).toContain('--nonexistent');
  });

  it('keeps the raw text of a demoted stage exactly', () => {
    // The promise is "what you typed is what runs". A demoted stage is the
    // mechanism that keeps it.
    const raw = 'aa-combine -o out.zarr --nonexistent 3';
    expect(parseSegment(raw).raw).toBe(raw);
  });

  it('demotes a stage whose flag has no value', () => {
    const stage = parseSegment('aa-combine -o');
    expect(stage.structured).toBe(false);
    expect(stage.unmapped).toContain('-o');
  });

  it('demotes an inline value on a boolean flag', () => {
    // argparse's store_true does not accept one, so claiming to understand it
    // would be claiming to understand a command that does not run.
    const stage = parseSegment('aa-combine --report=false');
    expect(stage.structured).toBe(false);
  });

  it('demotes a second positional with nowhere to go', () => {
    // Two candidate inputs and nothing to say which the tool reads is exactly
    // the state ParamDef.role exists to prevent.
    const stage = parseSegment('aa-fetch one.raw two.raw');
    expect(stage.structured).toBe(false);
    expect(stage.unmapped).toContain('two.raw');
  });

  it('treats an unknown program as freeform', () => {
    const stage = parseSegment('grep -v WARN');
    expect(stage.structured).toBe(false);
    expect(stage.template).toBeUndefined();
    expect(stage.tool).toBe('grep');
  });

  it('does not try to structure the freeform catalogue entry itself', () => {
    const stage = parseSegment('sh -c "echo hi"');
    expect(stage.structured).toBe(false);
  });
});

describe('parseCommand', () => {
  it('produces one stage per pipe segment, in order', () => {
    const stages = parseCommand('aa-fetch x.raw | aa-raw --overwrite | grep -v WARN');
    expect(stages.map((s) => s.tool)).toEqual(['aa-fetch', 'aa-raw', 'grep']);
  });

  it('mixes structured and freeform stages in one chain', () => {
    // The whole point of the feature: structure where it is available,
    // verbatim bash everywhere else, in a single command.
    const stages = parseCommand('aa-fetch x.raw | grep -v WARN | aa-combine -o out.zarr');
    expect(stages.map((s) => s.structured)).toEqual([true, false, true]);
  });
});

describe('buildPipeline', () => {
  it('builds a structured stage with its parsed values', () => {
    const { stages, values } = buildPipeline(parseCommand('aa-combine -o out.zarr'));
    expect(stages).toHaveLength(1);
    expect(stages[0].tool).toBe('aa-combine');
    expect(stages[0].freeform).toBeFalsy();
    expect(values[stages[0].id].output).toBe('out.zarr');
  });

  it('builds a freeform stage carrying the verbatim command', () => {
    const { stages, values } = buildPipeline(parseCommand('grep -v WARN'));
    expect(stages[0].freeform).toBe(true);
    expect(values[stages[0].id][COMMAND_OVERRIDE]).toBe('grep -v WARN');
  });

  it('names a freeform stage after its program', () => {
    // A step list reading "sh, sh, sh" tells the reader nothing, and the
    // program is known even when its flags are not.
    const { stages } = buildPipeline(parseCommand('grep -v WARN | sort -u'));
    expect(stages.map((s) => s.id)).toEqual(['grep-1', 'sort-2']);
  });

  it('gives every stage a distinct id', () => {
    const { stages } = buildPipeline(
      parseCommand('grep a | grep b | aa-raw | aa-raw --overwrite'),
    );
    expect(new Set(stages.map((s) => s.id)).size).toBe(stages.length);
  });

  it('leaves parameter defaults alone', () => {
    /* `pipelineTypes` records that an untouched field must send nothing, so
       the tool's own default keeps applying. Baking a typed value into the
       ParamDef default would pin it into the pipeline forever. */
    const { stages } = buildPipeline(parseCommand('aa-combine -o mine.zarr'));
    const output = stages[0].params.find((p) => p.id === 'output');
    expect(output?.default).toBe('combined.zarr');
  });
});

describe('templateForSegment', () => {
  it('replaces the selected file with the input token', () => {
    expect(templateForSegment('grep -l /data/x.raw', '/data/x.raw')).toBe(
      `grep -l ${INPUT_TOKEN}`,
    );
  });

  it('replaces a quoted spelling without leaving stray quotes', () => {
    expect(templateForSegment('grep -l "/data/x.raw"', '/data/x.raw')).toBe(
      `grep -l ${INPUT_TOKEN}`,
    );
  });

  it('leaves a segment that does not mention the file', () => {
    // Correct for a pipe filter reading stdin: it never names its input.
    expect(templateForSegment('grep -v WARN', '/data/x.raw')).toBe('grep -v WARN');
  });

  it('leaves everything alone when nothing is selected', () => {
    expect(templateForSegment('grep -l /data/x.raw', null)).toBe('grep -l /data/x.raw');
  });
});
