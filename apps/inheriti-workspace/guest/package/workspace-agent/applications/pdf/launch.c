#include <stdlib.h>
#include <unistd.h>

void workspace_launch_pdf(const char *binary, const char *file,
                          const char *view, const char *session_dir) {
    (void)view;
    (void)session_dir;
    char *const args[] = {"mupdf-x11", (char *)file, NULL};
#ifdef WORKSPACE_AGENT_TEST
    const char *test_pdf = getenv("WORKSPACE_TEST_PDF_VIEW");
    execv(test_pdf ? test_pdf : binary, args);
#else
    execv(binary, args);
#endif
}
