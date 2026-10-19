#include <unistd.h>

/* Only the checked guest mount path is executable; the file stays in /run/session. */
void workspace_launch_optional(const char *binary, const char *file,
                               const char *view, const char *session_dir) {
    (void)view;
    char *const args[] = {(char *)binary, (char *)file, (char *)session_dir, NULL};
    execv(binary, args);
}
