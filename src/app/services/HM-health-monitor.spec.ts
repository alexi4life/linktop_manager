import { TestBed } from '@angular/core/testing';

import { HealthMonitorService } from './HM-health-monitor';

describe('HealthMonitorService', () => {
  let service: HealthMonitorService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(HealthMonitorService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
