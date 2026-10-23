import { TestBed } from '@angular/core/testing';

import { Linktop } from './HM-linktop';

describe('Linktop', () => {
  let service: Linktop;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Linktop);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
