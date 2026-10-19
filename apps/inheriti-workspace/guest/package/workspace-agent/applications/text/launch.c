#define _POSIX_C_SOURCE 200809L
#include <stdlib.h>
#include <unistd.h>

void workspace_launch_text(const char *binary, const char *file,
                           const char *view, const char *session_dir) {
    (void)session_dir;
    if (setenv("LESSSECURE", "1", 1) ||
        setenv("LESSHISTFILE", "/dev/null", 1) ||
        setenv("LESSCHARSET", "utf-8", 1)) return;
    unsetenv("LESSSECURE_ALLOW");
    unsetenv("LESSOPEN");
    unsetenv("LESSCLOSE");
    unsetenv("LESS");
    char *const args[] = {"xterm", "-xrm", "*locale: false", "-u8",
                          "-fa", "monospace", "-fs", "12",
                          "-e", "/usr/bin/less", "--",
                          (char *)(view && *view ? view : file), NULL};
    execv(binary, args);
}
