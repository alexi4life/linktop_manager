import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RingHomePage } from './ring-home.page';

describe('RingHomePage', () => {
  let component: RingHomePage;
  let fixture: ComponentFixture<RingHomePage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(RingHomePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
