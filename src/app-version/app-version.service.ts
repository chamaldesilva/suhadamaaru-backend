import { Injectable } from '@nestjs/common';

export interface VersionInfo {
  currentVersion: string;
  latestVersion: string;
  minimumVersion: string;
  updateAvailable: boolean;
  forceUpdate: boolean;
  storeUrl: string;
}

@Injectable()
export class AppVersionService {
  // Configure these values based on your app versions
  private readonly IOS_LATEST_VERSION = '1.0.0';
  private readonly IOS_MINIMUM_VERSION = '1.0.0';
  private readonly ANDROID_LATEST_VERSION = '1.0.0';
  private readonly ANDROID_MINIMUM_VERSION = '1.0.0';

  private readonly IOS_APP_STORE_ID = '6758573604';
  private readonly ANDROID_PACKAGE = 'com.chamzo.suhadamaaru';

  checkVersion(
    platform: 'ios' | 'android',
    currentVersion: string,
  ): VersionInfo {
    const latestVersion =
      platform === 'ios'
        ? this.IOS_LATEST_VERSION
        : this.ANDROID_LATEST_VERSION;
    const minimumVersion =
      platform === 'ios'
        ? this.IOS_MINIMUM_VERSION
        : this.ANDROID_MINIMUM_VERSION;

    const updateAvailable =
      this.compareVersions(latestVersion, currentVersion) > 0;
    const forceUpdate =
      this.compareVersions(currentVersion, minimumVersion) < 0;

    const storeUrl =
      platform === 'ios'
        ? `https://apps.apple.com/app/id${this.IOS_APP_STORE_ID}`
        : `https://play.google.com/store/apps/details?id=${this.ANDROID_PACKAGE}`;

    return {
      currentVersion,
      latestVersion,
      minimumVersion,
      updateAvailable,
      forceUpdate,
      storeUrl,
    };
  }

  async getLatestVersion(platform: 'ios' | 'android') {
    if (platform === 'ios') {
      try {
        // Fetch from App Store
        const response = await fetch(
          `https://itunes.apple.com/lookup?id=${this.IOS_APP_STORE_ID}&country=us`,
        );
        const data = await response.json();

        if (data.resultCount > 0) {
          return {
            version: data.results[0].version,
            releaseNotes: data.results[0].releaseNotes,
          };
        }
      } catch (error) {
        console.error('Error fetching iOS version:', error);
      }

      return { version: this.IOS_LATEST_VERSION };
    } else {
      try {
        // Fetch from Google Play Store (scraping)
        const response = await fetch(
          `https://play.google.com/store/apps/details?id=${this.ANDROID_PACKAGE}&hl=en`,
        );
        const html = await response.text();

        // Extract version from Play Store page
        const versionMatch = html.match(/\[\[\["([\d.]+)"\]\]/);
        if (versionMatch && versionMatch[1]) {
          return { version: versionMatch[1] };
        }
      } catch (error) {
        console.error('Error fetching Android version:', error);
      }

      return { version: this.ANDROID_LATEST_VERSION };
    }
  }

  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;

      if (part1 > part2) return 1;
      if (part1 < part2) return -1;
    }

    return 0;
  }
}
