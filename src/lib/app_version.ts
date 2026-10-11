// E6.1 — Versiya məlumatı.
// ponytail: package.json version-u `0.0.0`-dır (bu repo heç vaxt onu bump etmir),
// App Store isə iOS MARKETING_VERSION / CURRENT_PROJECT_VERSION oxuyur. Ona görə
// bu iki sətir ios/App/App.xcodeproj/project.pbxproj ilə sinxron saxlanılır.
// Növbəti buraxılışda hər ikisini birlikdə artır.
export const APP_VERSION = "1.4.0";
export const APP_BUILD = "1460";
