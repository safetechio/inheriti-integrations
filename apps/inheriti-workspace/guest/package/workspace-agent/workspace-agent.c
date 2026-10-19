#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <stdint.h>
#include <signal.h>
#include <sys/prctl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include "format_catalog.h"
#include "applications/catalog.h"

#define MAX_FILES 16u
#define MAX_NAME 255u
#define MAX_BYTES (16u * 1024u * 1024u)
#define CHANNEL "/dev/virtio-ports/org.inheriti.workspace"
#ifndef WORKSPACE_OOXML_VALIDATOR
#define WORKSPACE_OOXML_VALIDATOR "/usr/bin/workspace-ooxml-validate"
#endif
static const char *session_dir = "/run/session";

struct file_entry {
    char name[MAX_NAME + 1];
    char path[64];
    char display_path[64];
    const struct workspace_viewer *viewer;
};

static int convert_document(int channel, const struct file_entry *entry) {
    pid_t parent = getpid();
    pid_t child = fork();
    if (child < 0) return -1;
    if (child == 0) {
        struct rlimit core = {0, 0}, cpu = {12, 12};
        struct rlimit memory = {192u * 1024u * 1024u, 192u * 1024u * 1024u};
        struct rlimit output = {2u * 1024u * 1024u, 2u * 1024u * 1024u};
        if (setrlimit(RLIMIT_CORE, &core) || setrlimit(RLIMIT_CPU, &cpu) || setrlimit(RLIMIT_AS, &memory) ||
            setrlimit(RLIMIT_FSIZE, &output)) _exit(127);
        close(channel);
        alarm(20);
#ifndef WORKSPACE_AGENT_TEST
        if (setgid(65534) || setuid(65534)) _exit(127);
#endif
        if (prctl(PR_SET_PDEATHSIG, SIGKILL) || getppid() != parent) _exit(127);
        char *const args[] = {(char *)entry->viewer->converter, (char *)entry->path,
                              (char *)entry->display_path, NULL};
        execv(entry->viewer->converter, args);
        _exit(127);
    }
    int status;
    while (waitpid(child, &status, 0) < 0) if (errno != EINTR) return -1;
    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) return -1;
    struct stat st;
    if (lstat(entry->display_path, &st) || !S_ISREG(st.st_mode) || st.st_size <= 0 ||
        st.st_size > 2u * 1024u * 1024u || st.st_uid !=
#ifdef WORKSPACE_AGENT_TEST
        getuid()
#else
        65534
#endif
    ) return -1;
    return 0;
}

static int validate_ooxml(int channel, const struct file_entry *entry) {
    pid_t parent = getpid();
    pid_t child = fork();
    if (child < 0) return -1;
    if (child == 0) {
        struct rlimit core = {0, 0}, cpu = {12, 12};
        struct rlimit memory = {192u * 1024u * 1024u, 192u * 1024u * 1024u};
        if (setrlimit(RLIMIT_CORE, &core) || setrlimit(RLIMIT_CPU, &cpu) ||
            setrlimit(RLIMIT_AS, &memory)) _exit(127);
        close(channel);
        alarm(20);
#ifndef WORKSPACE_AGENT_TEST
        if (setgid(65534) || setuid(65534)) _exit(127);
#endif
        if (prctl(PR_SET_PDEATHSIG, SIGKILL) || getppid() != parent) _exit(127);
        const char *kind = entry->viewer->format == FORMAT_DOCX ? "docx" : "xlsx";
        char *const args[] = {WORKSPACE_OOXML_VALIDATOR, (char *)entry->path,
                              (char *)kind, NULL};
        execv(WORKSPACE_OOXML_VALIDATOR, args);
        _exit(127);
    }
    int status;
    while (waitpid(child, &status, 0) < 0) if (errno != EINTR) return -1;
    return WIFEXITED(status) && WEXITSTATUS(status) == 0 ? 0 : -1;
}

static int read_session(int fd, void *buffer, size_t size, pid_t *viewer) {
    unsigned char *p = buffer;
    while (size) {
        if (*viewer > 0) {
            int status;
            pid_t exited = waitpid(*viewer, &status, WNOHANG);
            if (exited == *viewer || (exited < 0 && errno != EINTR)) {
                *viewer = -1;
                return -1;
            }
        }
        struct pollfd channel = {.fd = fd, .events = POLLIN};
        int ready = poll(&channel, 1, *viewer > 0 ? 100 : -1);
        if (ready < 0 && errno == EINTR) continue;
        if (ready < 0) return -1;
        if (ready == 0) continue;
        ssize_t got = read(fd, p, size);
        if (got < 0 && errno == EINTR) continue;
        if (got <= 0) return -1;
        p += got;
        size -= (size_t)got;
    }
    return 0;
}

static int write_all(int fd, const void *buffer, size_t size) {
    const unsigned char *p = buffer;
    while (size) {
        ssize_t sent = write(fd, p, size);
        if (sent < 0 && errno == EINTR) continue;
        if (sent <= 0) return -1;
        p += sent;
        size -= (size_t)sent;
    }
    return 0;
}

static int valid_name(const char *name, size_t size) {
    if (!size || size > MAX_NAME || name[size - 1] == '.' || name[size - 1] == ' ' ||
        (size == 1 && name[0] == '.') ||
        (size == 2 && name[0] == '.' && name[1] == '.')) return 0;
    for (size_t i = 0; i < size; i++) {
        unsigned char ch = (unsigned char)name[i];
        if (ch < 32 || ch == 127 || ch == '/' || ch == '\\' || ch == ':') return 0;
    }
    return 1;
}

static int admit(int channel, struct file_entry *entry, size_t index, size_t size, pid_t *viewer) {
    unsigned char *data = malloc(size);
    if (!data) return -1;
    if (read_session(channel, data, size, viewer) != 0) { free(data); return -1; }
    entry->viewer = workspace_detect_format(entry->name, data, size);
    if (!entry->viewer || size > entry->viewer->max_bytes) { free(data); return -1; }
    int count = snprintf(entry->path, sizeof entry->path, "%s/file-%zu%s", session_dir, index, entry->viewer->suffix);
    if (count < 0 || (size_t)count >= sizeof entry->path) { free(data); return -1; }
    int file = open(entry->path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (file < 0) { free(data); return -1; }
    int good = write_all(file, data, size) == 0;
    free(data);
#ifndef WORKSPACE_AGENT_TEST
    if (good) good = fchown(file, 65534, 65534) == 0;
#endif
    if (close(file) != 0) good = 0;
    const struct workspace_application *application = workspace_select_application(
        entry->viewer->format, entry->viewer->application);
    if (!application) good = 0;
    if (good && application != entry->viewer->application &&
        (entry->viewer->format == FORMAT_DOCX || entry->viewer->format == FORMAT_XLSX))
        good = validate_ooxml(channel, entry) == 0;
    if (good && entry->viewer->converter && application == entry->viewer->application) {
        count = snprintf(entry->display_path, sizeof entry->display_path,
                         "%s/view-%zu.txt", session_dir, index);
        good = count >= 0 && (size_t)count < sizeof entry->display_path &&
               convert_document(channel, entry) == 0;
    }
    if (!good) {
        if (entry->display_path[0]) unlink(entry->display_path);
        unlink(entry->path);
    }
    return good ? 0 : -1;
}

static void stop_viewer(pid_t *viewer) {
    if (*viewer <= 0) return;
    kill(-*viewer, SIGKILL);
    while (waitpid(*viewer, NULL, 0) < 0 && errno == EINTR) {}
    *viewer = -1;
}

static int application_ready(int fd) {
    struct timespec now;
    if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) return -1;
    long long deadline = (long long)now.tv_sec * 1000 + now.tv_nsec / 1000000 + 20000;
    for (;;) {
        if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) return -1;
        long long remaining = deadline - ((long long)now.tv_sec * 1000 + now.tv_nsec / 1000000);
        if (remaining <= 0) return -1;
        struct pollfd pfd = {.fd = fd, .events = POLLIN};
        int result = poll(&pfd, 1, (int)remaining);
        if (result < 0 && errno == EINTR) continue;
        if (result <= 0) return -1;
        unsigned char signal;
        return read(fd, &signal, 1) == 1 && signal == 'R' ? 0 : -1;
    }
}

static int launch_file(int channel, const struct file_entry *entry, pid_t *viewer) {
    stop_viewer(viewer);
    const struct workspace_application *application = workspace_select_application(
        entry->viewer->format, entry->viewer->application);
    if (!application) return -1;
    /* A missing adapter cannot fall back to a view that was never converted. */
    if (entry->viewer->converter && !entry->display_path[0] &&
        application == entry->viewer->application) return -1;
    int needs_ready = application->signals_ready;
    int ready_pipe[2] = {-1, -1};
    if (needs_ready && pipe(ready_pipe) != 0) return -1;
    pid_t child = fork();
    if (child < 0) {
        if (needs_ready) { close(ready_pipe[0]); close(ready_pipe[1]); }
        return -1;
    }
    if (child == 0) {
        close(channel);
        if (needs_ready) {
            close(ready_pipe[0]);
            if (ready_pipe[1] != 3 && dup2(ready_pipe[1], 3) < 0) _exit(127);
            if (ready_pipe[1] != 3) close(ready_pipe[1]);
            if (fcntl(3, F_SETFD, 0) < 0) _exit(127);
        }
        if (setpgid(0, 0) != 0) _exit(127);
        struct rlimit core = {0, 0};
        rlim_t memory_bytes = 192u * 1024u * 1024u;
        if (application != entry->viewer->application &&
            entry->viewer->format == FORMAT_DOCX)
            memory_bytes = 1024u * 1024u * 1024u;
        if (application != entry->viewer->application &&
            (entry->viewer->format == FORMAT_CSV || entry->viewer->format == FORMAT_XLSX ||
             entry->viewer->format == FORMAT_MP4 || entry->viewer->format == FORMAT_WEBM))
            memory_bytes = 512u * 1024u * 1024u;
        struct rlimit memory = {memory_bytes, memory_bytes};
        if (setrlimit(RLIMIT_CORE, &core) || setrlimit(RLIMIT_AS, &memory)) _exit(127);
#ifndef WORKSPACE_AGENT_TEST
        if (setgid(65534) || setuid(65534)) _exit(127);
#endif
        application->launch(application->binary, entry->path,
                            entry->display_path, session_dir);
        _exit(127);
    }
    if (needs_ready) close(ready_pipe[1]);
    if (setpgid(child, child) != 0 && errno != EACCES && errno != ESRCH) {
        kill(child, SIGKILL);
        waitpid(child, NULL, 0);
        if (needs_ready) close(ready_pipe[0]);
        return -1;
    }
    if (needs_ready) {
        int ready = application_ready(ready_pipe[0]);
        close(ready_pipe[0]);
        if (ready != 0) {
            kill(-child, SIGKILL);
            while (waitpid(child, NULL, 0) < 0 && errno == EINTR) {}
            return -1;
        }
        int status;
        if (waitpid(child, &status, WNOHANG) != 0) {
            kill(-child, SIGKILL);
            return -1;
        }
        *viewer = child;
        return 0;
    }
    struct timespec pause = {0, 500000000};
    while (nanosleep(&pause, &pause) < 0 && errno == EINTR) {}
    int status;
    if (waitpid(child, &status, WNOHANG) != 0) return -1;
    *viewer = child;
    return 0;
}

int main(
#ifdef WORKSPACE_AGENT_TEST
    int argc, char **argv
#else
    void
#endif
) {
    int channel;
#ifdef WORKSPACE_AGENT_TEST
    if (argc != 4 || strcmp(argv[1], "--fd") != 0) return 2;
    char *end = NULL;
    long fd = strtol(argv[2], &end, 10);
    if (!end || *end || fd < 3 || fd > 1024) return 2;
    session_dir = argv[3];
    channel = (int)fd;
#else
    channel = open(CHANNEL, O_RDWR | O_CLOEXEC);
#endif
    if (channel < 0) return 2;
    const unsigned char ready = 0x52, ack = 0x06, nak = 0x15;
    if (write_all(channel, &ready, 1) != 0) return 2;
    struct file_entry files[MAX_FILES] = {0};
    size_t count = 0, total = 0;
    ssize_t pending = -1;
    pid_t viewer = -1;
    for (;;) {
        unsigned char header[7];
        if (read_session(channel, header, sizeof header, &viewer) != 0) break;
        size_t name_size = ((size_t)header[1] << 8) | header[2];
        size_t data_size = ((size_t)header[3] << 24) | ((size_t)header[4] << 16) |
                           ((size_t)header[5] << 8) | header[6];
        if (!name_size || name_size > MAX_NAME) break;
        char name[MAX_NAME + 1];
        if (read_session(channel, name, name_size, &viewer) != 0) break;
        name[name_size] = 0;
        if (!valid_name(name, name_size)) {
            write_all(channel, &nak, 1);
            break;
        }
        if (header[0] == 1 && pending < 0 && data_size && count < MAX_FILES &&
            data_size <= MAX_BYTES - total) {
            int duplicate = 0;
            for (size_t i = 0; i < count; i++)
                if (strcasecmp(files[i].name, name) == 0) duplicate = 1;
            if (duplicate) break;
            memcpy(files[count].name, name, name_size + 1);
            if (admit(channel, &files[count], count, data_size, &viewer) != 0) {
                write_all(channel, &nak, 1);
                break;
            }
            total += data_size;
            pending = (ssize_t)count++;
        } else if (header[0] == 2 && pending >= 0 && data_size == 0 &&
                   strcmp(files[pending].name, name) == 0) {
            if (launch_file(channel, &files[pending], &viewer) != 0) {
                write_all(channel, &nak, 1);
                break;
            }
            pending = -1;
        } else {
            write_all(channel, &nak, 1);
            break;
        }
        if (write_all(channel, &ack, 1) != 0) break;
    }
    stop_viewer(&viewer);
    close(channel);
    return 0;
}
