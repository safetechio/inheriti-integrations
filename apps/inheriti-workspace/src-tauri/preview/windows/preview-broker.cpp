// Build with MSVC: cl /std:c++17 /EHsc /O2 preview-broker.cpp /link userenv.lib
// The caller sends bounded text on stdin. Only the fixed sibling helper runs in AppContainer.
#define NOMINMAX
#include <windows.h>
#include <aclapi.h>
#include <userenv.h>
#include <string>
#include <vector>

#pragma comment(lib, "userenv.lib")
#pragma comment(lib, "advapi32.lib")

namespace {
constexpr DWORD kMaxBytes = 64 * 1024;
constexpr wchar_t kProfile[] = L"SafeTech.InheritiWorkspace.Preview";

struct Handle {
    HANDLE value = nullptr;
    ~Handle() { reset(); }
    Handle() = default;
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    HANDLE* out() { return &value; }
    void reset() {
        if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value);
        value = nullptr;
    }
};

struct Sid {
    PSID value = nullptr;
    ~Sid() { if (value) FreeSid(value); }
};

struct Attributes {
    std::vector<unsigned char> memory;
    PPROC_THREAD_ATTRIBUTE_LIST value = nullptr;
    ~Attributes() { if (value) DeleteProcThreadAttributeList(value); }
};

bool fixed_helper(std::wstring& path) {
    wchar_t module[MAX_PATH];
    DWORD size = GetModuleFileNameW(nullptr, module, MAX_PATH);
    if (!size || size == MAX_PATH) return false;
    path.assign(module, size);
    auto separator = path.find_last_of(L"\\/");
    if (separator == std::wstring::npos) return false;
    path.resize(separator + 1);
    path += L"preview-helper.exe";
    DWORD attributes = GetFileAttributesW(path.c_str());
    return attributes != INVALID_FILE_ATTRIBUTES && !(attributes & FILE_ATTRIBUTE_DIRECTORY);
}

bool read_input(std::vector<unsigned char>& input) {
    unsigned char chunk[4096];
    DWORD count = 0;
    HANDLE source = GetStdHandle(STD_INPUT_HANDLE);
    BOOL ok = FALSE;
    while ((ok = ReadFile(source, chunk, sizeof(chunk), &count, nullptr)) && count) {
        if (input.size() + count > kMaxBytes) return false;
        input.insert(input.end(), chunk, chunk + count);
    }
    return !input.empty() && (ok || GetLastError() == ERROR_BROKEN_PIPE);
}

bool profile(Sid& sid) {
    HRESULT result = CreateAppContainerProfile(kProfile, kProfile, kProfile, nullptr, 0, &sid.value);
    if (result == HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS)) {
        result = DeriveAppContainerSidFromAppContainerName(kProfile, &sid.value);
    }
    return SUCCEEDED(result) && sid.value;
}

void grant_helper_access(const std::wstring& helper, PSID sid) {
    PACL old_acl = nullptr;
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    DWORD result = GetNamedSecurityInfoW(const_cast<LPWSTR>(helper.c_str()), SE_FILE_OBJECT,
                                         DACL_SECURITY_INFORMATION, nullptr, nullptr,
                                         &old_acl, nullptr, &descriptor);
    if (result != ERROR_SUCCESS) return;
    EXPLICIT_ACCESSW access{};
    access.grfAccessPermissions = FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;
    access.grfAccessMode = SET_ACCESS;
    access.grfInheritance = NO_INHERITANCE;
    access.Trustee.TrusteeForm = TRUSTEE_IS_SID;
    access.Trustee.TrusteeType = TRUSTEE_IS_USER;
    access.Trustee.ptstrName = static_cast<LPWSTR>(sid);
    PACL new_acl = nullptr;
    result = SetEntriesInAclW(1, &access, old_acl, &new_acl);
    if (result == ERROR_SUCCESS) {
        result = SetNamedSecurityInfoW(const_cast<LPWSTR>(helper.c_str()), SE_FILE_OBJECT,
                                       DACL_SECURITY_INFORMATION, nullptr, nullptr,
                                       new_acl, nullptr);
    }
    if (new_acl) LocalFree(new_acl);
    if (descriptor) LocalFree(descriptor);
}

bool start_helper(const std::wstring& helper, PSID sid, HANDLE input, HANDLE output,
                  PROCESS_INFORMATION& process) {
    SECURITY_CAPABILITIES capabilities{};
    capabilities.AppContainerSid = sid; // No capability SIDs, including no network.
    HANDLE handles[] = {input, output};
    SIZE_T length = 0;
    InitializeProcThreadAttributeList(nullptr, 2, 0, &length);
    if (!length) return false;
    Attributes attributes;
    attributes.memory.resize(length);
    attributes.value = reinterpret_cast<PPROC_THREAD_ATTRIBUTE_LIST>(attributes.memory.data());
    if (!InitializeProcThreadAttributeList(attributes.value, 2, 0, &length) ||
        !UpdateProcThreadAttribute(attributes.value, 0, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
                                   &capabilities, sizeof(capabilities), nullptr, nullptr) ||
        !UpdateProcThreadAttribute(attributes.value, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                                   handles, sizeof(handles), nullptr, nullptr)) return false;

    STARTUPINFOEXW startup{};
    startup.StartupInfo.cb = sizeof(startup);
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = input;
    startup.StartupInfo.hStdOutput = output;
    startup.StartupInfo.hStdError = output;
    startup.lpAttributeList = attributes.value;
    return CreateProcessW(helper.c_str(), nullptr, nullptr, nullptr, TRUE,
                          EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW | CREATE_SUSPENDED,
                          nullptr, nullptr, &startup.StartupInfo, &process) != 0;
}

int run(bool check_only) {
    std::vector<unsigned char> input;
    if (!check_only && !read_input(input)) return 1;
    std::wstring helper;
    Sid sid;
    if (!fixed_helper(helper) || !profile(sid)) return 1;
    // A protected installation may pregrant this ACE; the real launch below is the final check.
    grant_helper_access(helper, sid.value);

    SECURITY_ATTRIBUTES inheritable{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    Handle child_input, parent_input, parent_output, child_output;
    if (!CreatePipe(child_input.out(), parent_input.out(), &inheritable, 0) ||
        !CreatePipe(parent_output.out(), child_output.out(), &inheritable, 0) ||
        !SetHandleInformation(parent_input.value, HANDLE_FLAG_INHERIT, 0) ||
        !SetHandleInformation(parent_output.value, HANDLE_FLAG_INHERIT, 0)) return 1;

    PROCESS_INFORMATION process{};
    if (!start_helper(helper, sid.value, child_input.value, child_output.value, process)) return 1;
    Handle child_process, child_thread;
    child_process.value = process.hProcess;
    child_thread.value = process.hThread;
    Handle job;
    job.value = CreateJobObjectW(nullptr, nullptr);
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE |
                                             JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
    limits.BasicLimitInformation.ActiveProcessLimit = 1;
    if (!job.value || !SetInformationJobObject(job.value, JobObjectExtendedLimitInformation,
                                              &limits, sizeof(limits)) ||
        !AssignProcessToJobObject(job.value, child_process.value)) {
        TerminateProcess(child_process.value, 1);
        return 1;
    }
    child_input.reset();
    child_output.reset();
    if (ResumeThread(child_thread.value) == static_cast<DWORD>(-1)) return 1;

    if (check_only) {
        parent_input.reset();
        // The fixed helper rejects empty input with 2; a loader failure has a different code.
        DWORD exit_code = 0;
        return WaitForSingleObject(child_process.value, 1000) == WAIT_OBJECT_0 &&
                       GetExitCodeProcess(child_process.value, &exit_code) && exit_code == 2 ? 0 : 1;
    }

    DWORD count = 0;
    if (!WriteFile(parent_input.value, input.data(), static_cast<DWORD>(input.size()), &count, nullptr) ||
        count != input.size()) return 1;
    parent_input.reset();

    std::vector<unsigned char> output;
    unsigned char chunk[4096];
    BOOL ok = FALSE;
    while ((ok = ReadFile(parent_output.value, chunk, sizeof(chunk), &count, nullptr)) && count) {
        if (output.size() + count > kMaxBytes) return 1;
        output.insert(output.end(), chunk, chunk + count);
    }
    if (!ok && GetLastError() != ERROR_BROKEN_PIPE) return 1;
    if (WaitForSingleObject(child_process.value, 1000) != WAIT_OBJECT_0) return 1;
    DWORD exit_code = 1;
    if (!GetExitCodeProcess(child_process.value, &exit_code) || exit_code != 0) return 1;
    HANDLE destination = GetStdHandle(STD_OUTPUT_HANDLE);
    return WriteFile(destination, output.data(), static_cast<DWORD>(output.size()), &count, nullptr) &&
                   count == output.size() ? 0 : 1;
}
} // namespace

int wmain(int argc, wchar_t** argv) {
    if (argc > 2 || (argc == 2 && wcscmp(argv[1], L"--check") != 0)) return 1;
    return run(argc == 2);
}
