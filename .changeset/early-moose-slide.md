---
"@chat/auth": patch
---

- Added markSessionStepUpPending function to manage session state during step-up authentication.
- Updated session model to include state field with values "active" and "step_up_pending".
- Modified refresh and step-up services to handle session state transitions appropriately.
- Ensured session state is restored to "active" upon successful token rotation.