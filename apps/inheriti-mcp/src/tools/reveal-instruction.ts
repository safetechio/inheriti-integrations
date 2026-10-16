export const pendingJobInstruction =
  'While WAITING, call check_reveal_status with this jobId every few seconds until status is ' +
  'DELIVERED, FAILED, or CANCELED. Relay each required user action and the final outcome to the ' +
  'user. This server cannot automatically wake the assistant.';
