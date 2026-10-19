/* Workspace test-only guest probe. Runs inside a disposable Linux initramfs. */
#define _POSIX_C_SOURCE 200809L
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <limits.h>
#ifdef WORKSPACE_RENDER_PROBE
#include <dirent.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <signal.h>
#include <time.h>
#endif
#include <unistd.h>

#define MAX_FILE (16u * 1024u * 1024u)
#define MAX_NAME 255u
#define MAX_FILES 16u
#define ACK 0x06
#define NAK 0x15
#define READY 0x52
#define FILE_PATH "/run/session/input"

static int safe_basename(const char *name, size_t size) {
  if (!size || size > MAX_NAME || (size == 1 && name[0] == '.') ||
      (size == 2 && name[0] == '.' && name[1] == '.') ||
      name[size - 1] == '.' || name[size - 1] == ' ') return 0;
  for (size_t i = 0; i < size; i++) {
    unsigned char ch = (unsigned char)name[i];
    if (ch < 32 || ch == 127 || ch == '/' || ch == '\\' || ch == ':') return 0;
  }
  char stem[5] = {0};
  size_t stem_size = 0;
  while (stem_size < size && name[stem_size] != '.') {
    unsigned char ch = (unsigned char)name[stem_size];
    if (stem_size < 4) stem[stem_size] = ch >= 'a' && ch <= 'z' ? (char)(ch - 32) : (char)ch;
    stem_size++;
  }
  if ((stem_size == 3 && (!strcmp(stem, "CON") || !strcmp(stem, "PRN") ||
                          !strcmp(stem, "AUX") || !strcmp(stem, "NUL"))) ||
      (stem_size == 4 && ((!memcmp(stem, "COM", 3) || !memcmp(stem, "LPT", 3)) &&
                          stem[3] >= '1' && stem[3] <= '9'))) return 0;
  return 1;
}

static int read_exact(int fd, void *buffer, size_t count) {
  unsigned char *p = buffer;
  while (count) {
    ssize_t n = read(fd, p, count);
    if (n <= 0) return -1;
    p += n;
    count -= (size_t)n;
  }
  return 0;
}

static int write_exact(int fd, const void *buffer, size_t count) {
  const unsigned char *p = buffer;
  while (count) {
    ssize_t n = write(fd, p, count);
    if (n <= 0) return -1;
    p += n;
    count -= (size_t)n;
  }
  return 0;
}

static int supported_probe(const unsigned char *p, size_t n) {
  if (n >= 5 && memcmp(p, "%PDF-", 5) == 0) return 1;
  if (n >= 8 && memcmp(p, "\x89PNG\r\n\x1a\n", 8) == 0) return 1;
  if (n >= 3 && p[0] == 0xff && p[1] == 0xd8 && p[2] == 0xff) return 1;
  if (n >= 12 && memcmp(p, "RIFF", 4) == 0 && memcmp(p + 8, "WEBP", 4) == 0) return 1;
  return 0;
}

#ifdef WORKSPACE_RENDER_PROBE
static int guest_has_no_network_or_share(void) {
  DIR *interfaces = opendir("/sys/class/net");
  if (!interfaces) return 0;
  struct dirent *entry;
  int clean = 1;
  while ((entry = readdir(interfaces)) != NULL) {
    if (strcmp(entry->d_name, ".") && strcmp(entry->d_name, "..") &&
        strcmp(entry->d_name, "lo")) clean = 0;
  }
  closedir(interfaces);
  FILE *mounts = fopen("/proc/mounts", "r");
  if (!mounts) return 0;
  char line[1024];
  while (fgets(line, sizeof line, mounts)) {
    if (strstr(line, " 9p ") || strstr(line, " virtiofs ") ||
        strstr(line, " nfs ") || strstr(line, " cifs ") ||
        strstr(line, " fuse.")) clean = 0;
  }
  fclose(mounts);
  return clean;
}

/* Test-only: render to bounded guest tmpfs; never return rendered bytes to host. */
static int render_probe(const unsigned char *p, size_t n, const char *path, int channel) {
  int flags = fcntl(channel, F_GETFD);
  if (flags < 0 || !(flags & FD_CLOEXEC)) return 0;
  struct stat channel_info;
  if (fstat(channel, &channel_info) || (channel_info.st_mode & 0007)) return 0;
  const char *program;
  int pdf = 0;
  char *const pdf_args[] = {"pdftoppm", "-f", "1", "-l", "1", "-singlefile", "-scale-to", "1024", "-png", (char *)path, "/run/session/rendered", NULL};
  char *const jpg_args[] = {"djpeg", "-scale", "1/2", "-outfile", "/run/session/rendered.ppm", (char *)path, NULL};
  char *const *args;
  const char *output;
  if (n >= 5 && memcmp(p, "%PDF-", 5) == 0) {
    pdf = 1; program = "/usr/bin/pdftoppm"; args = pdf_args; output = "/run/session/rendered.png";
  } else if (n >= 3 && p[0] == 0xff && p[1] == 0xd8 && p[2] == 0xff) {
    program = "/usr/bin/djpeg"; args = jpg_args; output = "/run/session/rendered.ppm";
  } else return 0;
  pid_t child = fork();
  if (child < 0) return 0;
  if (child == 0) {
    struct rlimit cpu = {3, 3}, fsize = {12u * 1024u * 1024u, 12u * 1024u * 1024u};
    struct rlimit address = {192u * 1024u * 1024u, 192u * 1024u * 1024u};
    if (setrlimit(RLIMIT_CPU, &cpu) || setrlimit(RLIMIT_FSIZE, &fsize) ||
        setrlimit(RLIMIT_AS, &address)) _exit(127);
    int null = open("/dev/null", O_WRONLY);
    if (null < 0 || dup2(null, STDOUT_FILENO) < 0 || dup2(null, STDERR_FILENO) < 0) _exit(127);
    if (setgid(65534) || setuid(65534)) _exit(127);
    close(null);
    execv(program, args);
    _exit(127);
  }
  int status = 0;
  time_t deadline = time(NULL) + 5;
  for (;;) {
    pid_t done = waitpid(child, &status, WNOHANG);
    if (done == child) break;
    if (done < 0 || time(NULL) >= deadline) {
      kill(child, SIGKILL); waitpid(child, &status, 0); return 0;
    }
    struct timespec pause = {0, 10000000};
    nanosleep(&pause, NULL);
  }
  if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) return 0;
  int rendered = open(output, O_RDONLY | O_NOFOLLOW);
  if (rendered < 0) return 0;
  unsigned char signature[8] = {0};
  ssize_t read_count = read(rendered, signature, sizeof signature);
  off_t size = lseek(rendered, 0, SEEK_END);
  close(rendered);
  if (size <= 16 || size > 12 * 1024 * 1024 || read_count < 3) return 0;
  return pdf ? (read_count == 8 && memcmp(signature, "\x89PNG\r\n\x1a\n", 8) == 0)
             : (signature[0] == 'P' && signature[1] == '6');
}
#endif

static int readback_matches(const char *path, const unsigned char *expected, size_t size) {
  int file = open(path, O_RDONLY | O_NOFOLLOW);
  if (file < 0) return 0;
  unsigned char block[4096];
  size_t offset = 0;
  int ok = 1;
  while (offset < size) {
    size_t want = size - offset < sizeof block ? size - offset : sizeof block;
    if (read_exact(file, block, want) != 0 || memcmp(block, expected + offset, want) != 0) {
      ok = 0;
      break;
    }
    offset += want;
  }
  unsigned char extra;
  if (ok && read(file, &extra, 1) != 0) ok = 0;
  close(file);
  return ok;
}

int main(int argc, char **argv) {
  int channel = -1;
  const char *file_path = FILE_PATH;
  if (argc == 1) channel = open("/dev/virtio-ports/org.inheriti.workspace", O_RDWR);
  /* Local protocol test only; init always opens the virtio device. */
  if (argc == 4 && strcmp(argv[1], "--fd") == 0) {
    char *end = NULL;
    long descriptor = strtol(argv[2], &end, 10);
    if (!end || *end || descriptor < 3 || descriptor > 1024) return 2;
    channel = (int)descriptor;
    file_path = argv[3];
  }
  if (channel < 0) return 2;
  int descriptor_flags = fcntl(channel, F_GETFD);
  if (descriptor_flags < 0 || fcntl(channel, F_SETFD, descriptor_flags | FD_CLOEXEC) < 0) return 2;

  unsigned char ready = READY;
  if (write_exact(channel, &ready, 1) != 0) return 2;

  char names[MAX_FILES][MAX_NAME + 1] = {{0}};
  size_t total_size = 0;
  size_t file_count = 0;
  unsigned char *payload = NULL;
  size_t pending_size = 0;
  char pending_path[PATH_MAX] = {0};
  for (;;) {
    unsigned char header[7];
    if (read_exact(channel, header, sizeof header) != 0) break;
    size_t name_size = ((size_t)header[1] << 8) | header[2];
    size_t data_size = ((size_t)header[3] << 24) | ((size_t)header[4] << 16) |
                       ((size_t)header[5] << 8) | header[6];
    if (name_size == 0 || name_size > MAX_NAME || data_size > MAX_FILE) break;
    char name[MAX_NAME + 1];
    if (read_exact(channel, name, name_size) != 0) break;
    name[name_size] = 0;
    if (memchr(name, 0, name_size) != NULL || !safe_basename(name, name_size)) break;

    if (header[0] == 1 && !payload && data_size > 0 && file_count < MAX_FILES &&
        data_size <= MAX_FILE - total_size) {
      int duplicate = 0;
      for (size_t i = 0; i < file_count; i++) {
        if (strcasecmp(names[i], name) == 0) duplicate = 1;
      }
      if (duplicate) break;
      int path_size = file_count == 0
          ? snprintf(pending_path, sizeof pending_path, "%s", file_path)
          : snprintf(pending_path, sizeof pending_path, "%s-%zu", file_path, file_count + 1);
      if (path_size < 0 || (size_t)path_size >= sizeof pending_path) break;
      payload = malloc(data_size);
      if (!payload || read_exact(channel, payload, data_size) != 0) break;
      int file = open(pending_path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
      if (file < 0) break;
      int ok = write_exact(file, payload, data_size) == 0 && fsync(file) == 0;
      if (close(file) != 0) ok = 0;
      if (!ok || !readback_matches(pending_path, payload, data_size)) break;
#ifdef WORKSPACE_RENDER_PROBE
      if (chown(pending_path, 65534, 65534) != 0) break;
#endif
      memcpy(names[file_count], name, name_size + 1);
      pending_size = data_size;
      total_size += data_size;
      file_count++;
    } else if (header[0] == 2 && payload && data_size == 0 &&
               strcmp(names[file_count - 1], name) == 0) {
      /* Every launch is bound to its own admitted bytes and guest tmpfs path. */
      int valid = readback_matches(pending_path, payload, pending_size) &&
                  supported_probe(payload, pending_size);
#ifdef WORKSPACE_RENDER_PROBE
      if (valid) valid = guest_has_no_network_or_share() &&
                         render_probe(payload, pending_size, pending_path, channel);
#endif
      if (!valid) {
        unsigned char reject = NAK;
        write_exact(channel, &reject, 1);
        break;
      }
      free(payload);
      payload = NULL;
      pending_size = 0;
      pending_path[0] = 0;
    } else {
      /* Invalid state/frame. Avoid reading attacker-supplied payload beyond bounds. */
      break;
    }
    unsigned char ack = ACK;
    if (write_exact(channel, &ack, 1) != 0) break;
  }
  free(payload);
  if (argc == 1) close(channel);
  return 0;
}
