import { provideZonelessChangeDetection } from '@angular/core';

/**
 * TestBed providers for `ng test stack-weaver-angular`. zone.js is a devDependency (for the
 * zone spec), so the unit-test builder loads it and adds provideZoneChangeDetection()
 * for every spec. Keep the suite zoneless by default; the zone spec opts back in with
 * provideZoneChangeDetection() in its own configureTestingModule.
 */
export default [provideZonelessChangeDetection()];
