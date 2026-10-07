import { describe, expect, it } from 'vitest';

import { withoutSignInToken } from '../src/services/addressApi';

/** The address bar shows the address to keep (Help ▸ Link to this Workbench). */
describe('the address to bookmark', () => {
  it('drops the one-time sign-in token and nothing else', () => {
    expect(withoutSignInToken('https://8000-ws.c.cloudworkstations.dev/?_workstationAccessToken=abc')).toBe(
      'https://8000-ws.c.cloudworkstations.dev/',
    );
    expect(withoutSignInToken('https://h/?a=1&_workstationAccessToken=x#t')).toBe('https://h/?a=1#t');
    expect(withoutSignInToken('http://localhost:8000/')).toBe('http://localhost:8000/');
  });
});
