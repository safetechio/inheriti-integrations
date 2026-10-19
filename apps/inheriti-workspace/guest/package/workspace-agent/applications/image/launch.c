#include <unistd.h>

void workspace_launch_image(const char *binary, const char *file,
                            const char *view, const char *session_dir) {
    (void)view;
    (void)session_dir;
    char *const args[] = {"feh", "--fullscreen", "--scale-down", "--hide-pointer",
                          "--no-menus", "--", (char *)file, NULL};
    execv(binary, args);
}
