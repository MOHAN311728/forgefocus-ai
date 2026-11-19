#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <iterator>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <ctime>
#include <cstdio>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <vector>
#include <thread>

struct Task {
    int id{};
    std::string title;
    std::string subject;
    int days{};
    int hours{};
    bool completed{};
};

const std::string DATA_FILE = "focusforge_tasks.tsv";
const std::string SETTINGS_FILE = "focusforge_settings.txt";
const std::string PROFILE_FILE = "focusforge_game_profile.txt";
const int DEFAULT_DAILY_HOURS = 2;

struct StudyState {
    int xp{0};
    int sessions{0};
    int streak{1};
    int dailyXp{0};
    int questMask{0};
    int gamesPlayed{0};
    std::string date;
};

std::string studyDataFile(const std::string& profile) {
    if (profile == "local") return "memory_leak_study.txt";
    if (profile.empty() || profile.size() > 128 ||
        !std::all_of(profile.begin(), profile.end(), [](unsigned char ch) { return std::isdigit(ch); }))
        return "";
    return "memory_leak_student_" + profile + ".txt";
}

void saveStudyState(const StudyState& state, const std::string& profile = "local");
StudyState loadStudyState(const std::string& profile = "local");

std::string todayKey() {
    std::time_t now = std::time(nullptr);
    std::tm local{};
    localtime_r(&now, &local);
    char value[16]{};
    std::strftime(value, sizeof(value), "%Y-%m-%d", &local);
    return value;
}

StudyState loadStudyState(const std::string& profile) {
    StudyState state;
    const auto filePath = studyDataFile(profile);
    if (filePath.empty()) return state;
    std::ifstream file(filePath);
    if (file >> state.xp >> state.sessions >> state.streak >> state.dailyXp >> state.questMask >> state.date) {
        file >> state.gamesPlayed;
        if (state.date != todayKey()) {
            state.sessions = 0;
            state.dailyXp = 0;
            state.questMask = 0;
            state.date = todayKey();
            saveStudyState(state, profile);
        }
    } else state.date = todayKey();
    return state;
}

void saveStudyState(const StudyState& state, const std::string& profile) {
    const auto filePath = studyDataFile(profile);
    if (filePath.empty()) return;
    std::ofstream file(filePath, std::ios::trunc);
    file << state.xp << ' ' << state.sessions << ' ' << state.streak << ' '
         << state.dailyXp << ' ' << state.questMask << ' ' << state.date << ' '
         << state.gamesPlayed << '\n';
}

std::string studyJson(const StudyState& state) {
    std::ostringstream out;
    out << "{\"xp\":" << state.xp << ",\"dailyXp\":" << state.dailyXp
        << ",\"sessions\":" << state.sessions << ",\"streak\":" << state.streak
        << ",\"gamesPlayed\":" << state.gamesPlayed
        << ",\"quests\":{\"wake\":" << ((state.questMask & 1) ? "true" : "false")
        << ",\"sessions\":" << ((state.questMask & 2) ? "true" : "false")
        << ",\"practice\":" << ((state.questMask & 4) ? "true" : "false")
        << ",\"revise\":" << ((state.questMask & 8) ? "true" : "false") << "}}";
    return out.str();
}

struct FocusProfile {
    int level{1};
    int bestLevel{1};
    int paceMs{360};
};

FocusProfile loadProfile() {
    FocusProfile profile;
    std::ifstream file(PROFILE_FILE);
    int legacySecondValue = 0;
    if (file >> profile.level >> legacySecondValue >> profile.bestLevel) {
        profile.level = std::clamp(profile.level, 1, 8);
        profile.bestLevel = std::clamp(profile.bestLevel, 1, 8);
        if (!(file >> profile.paceMs)) profile.paceMs = 360;
        profile.paceMs = std::clamp(profile.paceMs, 220, 440);
    }
    return profile;
}

void saveProfile(const FocusProfile& profile) {
    std::ofstream file(PROFILE_FILE, std::ios::trunc);
    file << profile.level << " 0 " << profile.bestLevel << ' ' << profile.paceMs << '\n';
}

std::string profileJson(const FocusProfile& profile) {
    return "{\"level\":" + std::to_string(profile.level) +
           ",\"bestLevel\":" + std::to_string(profile.bestLevel) +
           ",\"paceMs\":" + std::to_string(profile.paceMs) + "}";
}

int loadDailyHours() {
    std::ifstream file(SETTINGS_FILE);
    int hours = DEFAULT_DAILY_HOURS;
    if (!(file >> hours) || hours < 1 || hours > 24) return DEFAULT_DAILY_HOURS;
    return hours;
}

void saveDailyHours(int hours) {
    std::ofstream file(SETTINGS_FILE, std::ios::trunc);
    file << hours << '\n';
}

std::string urlEncode(const std::string& value) {
    std::ostringstream out;
    out << std::hex;
    for (unsigned char ch : value) {
        if (std::isalnum(ch) || ch == '-' || ch == '_' || ch == '.' || ch == '~') out << ch;
        else if (ch == ' ') out << '+';
        else out << '%' << std::uppercase << (ch >> 4) << (ch & 15) << std::nouppercase;
    }
    return out.str();
}

int hexValue(char ch) {
    if (ch >= '0' && ch <= '9') return ch - '0';
    if (ch >= 'a' && ch <= 'f') return ch - 'a' + 10;
    if (ch >= 'A' && ch <= 'F') return ch - 'A' + 10;
    return 0;
}

std::string urlDecode(const std::string& value) {
    std::string out;
    for (std::size_t i = 0; i < value.size(); ++i) {
        if (value[i] == '+') out += ' ';
        else if (value[i] == '%' && i + 2 < value.size()) {
            out += static_cast<char>((hexValue(value[i + 1]) << 4) | hexValue(value[i + 2]));
            i += 2;
        } else out += value[i];
    }
    return out;
}

std::map<std::string, std::string> parseForm(const std::string& body) {
    std::map<std::string, std::string> fields;
    std::istringstream input(body);
    std::string part;
    while (std::getline(input, part, '&')) {
        auto equals = part.find('=');
        if (equals != std::string::npos)
            fields[urlDecode(part.substr(0, equals))] = urlDecode(part.substr(equals + 1));
    }
    return fields;
}

std::vector<Task> loadTasks() {
    std::vector<Task> tasks;
    std::ifstream file(DATA_FILE);
    std::string line;
    while (std::getline(file, line)) {
        std::istringstream row(line);
        std::string id, completed, days, hours, title, subject;
        if (std::getline(row, id, '\t') && std::getline(row, completed, '\t') &&
            std::getline(row, days, '\t') && std::getline(row, hours, '\t') &&
            std::getline(row, title, '\t') && std::getline(row, subject, '\t')) {
            tasks.push_back({std::stoi(id), urlDecode(title), urlDecode(subject),
                             std::stoi(days), std::stoi(hours), completed == "1"});
        }
    }
    return tasks;
}

void saveTasks(const std::vector<Task>& tasks) {
    std::ofstream file(DATA_FILE, std::ios::trunc);
    for (const auto& task : tasks)
        file << task.id << '\t' << (task.completed ? 1 : 0) << '\t' << task.days << '\t'
             << task.hours << '\t' << urlEncode(task.title) << '\t'
             << urlEncode(task.subject) << '\n';
}

std::string jsonEscape(const std::string& value) {
    std::string out;
    for (unsigned char ch : value) {
        if (ch == '"' || ch == '\\') { out += '\\'; out += static_cast<char>(ch); }
        else if (ch == '\n') out += "\\n";
        else if (ch == '\r') out += "\\r";
        else if (ch == '\t') out += "\\t";
        else if (ch >= 0x20) out += static_cast<char>(ch);
    }
    return out;
}

std::string tasksJson(const std::vector<Task>& tasks) {
    std::ostringstream out;
    out << '[';
    for (std::size_t i = 0; i < tasks.size(); ++i) {
        if (i) out << ',';
        const auto& task = tasks[i];
        out << "{\"id\":" << task.id << ",\"title\":\"" << jsonEscape(task.title)
            << "\",\"subject\":\"" << jsonEscape(task.subject) << "\",\"days\":"
            << task.days << ",\"hours\":" << task.hours << ",\"completed\":"
            << (task.completed ? "true" : "false") << '}';
    }
    out << ']';
    return out.str();
}

struct Response { int status; std::string label; std::string type; std::string body; };

const std::string AI_KEYS_FILE = "forgefocus_provider_keys.txt";

std::map<std::string, std::string> loadAiKeys() {
    std::map<std::string, std::string> keys;
    std::ifstream file(AI_KEYS_FILE);
    std::string line;
    while (std::getline(file, line)) {
        const auto split = line.find('=');
        if (split != std::string::npos) {
            const auto name = line.substr(0, split);
            if (name == "openai" || name == "gemini") keys[name] = urlDecode(line.substr(split + 1));
        }
    }
    return keys;
}

bool writeAllToFd(int fd, const std::string& content);

bool saveAiKeys(const std::map<std::string, std::string>& keys) {
    const int fd = open(AI_KEYS_FILE.c_str(), O_WRONLY | O_CREAT | O_TRUNC, S_IRUSR | S_IWUSR);
    if (fd < 0) return false;
    std::string content;
    for (const auto& name : {std::string("openai"), std::string("gemini")}) {
        const auto it = keys.find(name);
        if (it != keys.end()) content += name + '=' + urlEncode(it->second) + '\n';
    }
    const bool saved = writeAllToFd(fd, content) && fchmod(fd, S_IRUSR | S_IWUSR) == 0;
    close(fd);
    return saved;
}

std::string fileSetting(const char* name, const std::string& fallback) {
    const char* value = std::getenv(name);
    return value && *value ? value : fallback;
}

std::string curlConfigQuote(const std::string& value) {
    std::string result = "\"";
    for (char ch : value) {
        if (ch == '\\' || ch == '"') result += '\\';
        if (ch == '\r' || ch == '\n') continue;
        result += ch;
    }
    result += '"';
    return result;
}

bool writeAllToFd(int fd, const std::string& content) {
    std::size_t offset = 0;
    while (offset < content.size()) {
        const auto written = write(fd, content.data() + offset, content.size() - offset);
        if (written <= 0) return false;
        offset += static_cast<std::size_t>(written);
    }
    return true;
}

std::string runCurl(const std::string& endpoint, const std::string& apiKey,
                    const std::vector<std::string>& headers, const std::string& body, int& exitCode) {
    char bodyPath[] = "/tmp/forgefocus-body-XXXXXX";
    int bodyFd = mkstemp(bodyPath);
    if (bodyFd < 0) { exitCode = -1; return "Could not create a temporary AI request."; }
    fchmod(bodyFd, S_IRUSR | S_IWUSR);
    const bool bodyWritten = writeAllToFd(bodyFd, body);
    close(bodyFd);
    if (!bodyWritten) { unlink(bodyPath); exitCode = -1; return "Could not write the AI request."; }

    char configPath[] = "/tmp/forgefocus-curl-XXXXXX";
    int configFd = mkstemp(configPath);
    if (configFd < 0) { unlink(bodyPath); exitCode = -1; return "Could not create a private AI connection file."; }
    fchmod(configFd, S_IRUSR | S_IWUSR);
    std::string config = "silent\nshow-error\nmax-time = 75\nconnect-timeout = 12\nretry = 1\nretry-delay = 1\nretry-max-time = 5\nfail-with-body\n";
    config += "url = " + curlConfigQuote(endpoint) + "\n";
    for (const auto& header : headers) config += "header = " + curlConfigQuote(header) + "\n";
    if (!body.empty()) config += "data-binary = " + curlConfigQuote("@" + std::string(bodyPath)) + "\n";
    const bool configWritten = writeAllToFd(configFd, config);
    close(configFd);
    if (!configWritten) { unlink(bodyPath); unlink(configPath); exitCode = -1; return "Could not prepare the AI connection."; }

    int outputPipe[2];
    if (pipe(outputPipe) != 0) { unlink(bodyPath); unlink(configPath); exitCode = -1; return "Could not start the AI connection."; }
    const pid_t child = fork();
    if (child == 0) {
        dup2(outputPipe[1], STDOUT_FILENO);
        dup2(outputPipe[1], STDERR_FILENO);
        close(outputPipe[0]); close(outputPipe[1]);
        execl("/usr/bin/curl", "curl", "--config", configPath, static_cast<char*>(nullptr));
        _exit(127);
    }
    close(outputPipe[1]);
    std::string output;
    char buffer[4096];
    for (;;) {
        const auto count = read(outputPipe[0], buffer, sizeof(buffer));
        if (count <= 0) break;
        if (output.size() < 12 * 1024 * 1024) output.append(buffer, static_cast<std::size_t>(count));
    }
    close(outputPipe[0]);
    int status = 0;
    if (child < 0 || waitpid(child, &status, 0) < 0) exitCode = -1;
    else exitCode = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
    unlink(bodyPath); unlink(configPath);
    return output;
}

std::string jsonStringField(const std::string& source, const std::string& field) {
    const std::string needle = "\"" + field + "\"";
    auto pos = source.find(needle);
    while (pos != std::string::npos) {
        pos = source.find(':', pos + needle.size());
        if (pos == std::string::npos) return "";
        ++pos;
        while (pos < source.size() && std::isspace(static_cast<unsigned char>(source[pos]))) ++pos;
        if (pos >= source.size() || source[pos] != '"') {
            pos = source.find(needle, pos);
            continue;
        }
        ++pos;
        std::string value;
        while (pos < source.size()) {
            char ch = source[pos++];
            if (ch == '"') return value;
            if (ch != '\\') { value += ch; continue; }
            if (pos >= source.size()) break;
            ch = source[pos++];
            if (ch == 'n') value += '\n'; else if (ch == 'r') value += '\r';
            else if (ch == 't') value += '\t'; else if (ch == 'b') value += '\b';
            else if (ch == 'f') value += '\f';
            else if (ch == 'u' && pos + 4 <= source.size()) {
                unsigned int codepoint = 0;
                bool valid = true;
                for (int i = 0; i < 4; ++i) {
                    const char digit = source[pos++];
                    if (!std::isxdigit(static_cast<unsigned char>(digit))) { valid = false; break; }
                    codepoint = codepoint * 16 + static_cast<unsigned int>(hexValue(digit));
                }
                if (valid && codepoint >= 0xD800 && codepoint <= 0xDBFF && pos + 6 <= source.size() &&
                    source[pos] == '\\' && source[pos + 1] == 'u') {
                    pos += 2;
                    unsigned int low = 0;
                    for (int i = 0; i < 4; ++i) low = low * 16 + static_cast<unsigned int>(hexValue(source[pos++]));
                    if (low >= 0xDC00 && low <= 0xDFFF) codepoint = 0x10000 + ((codepoint - 0xD800) << 10) + low - 0xDC00;
                }
                if (!valid) continue;
                if (codepoint <= 0x7F) value += static_cast<char>(codepoint);
                else if (codepoint <= 0x7FF) { value += static_cast<char>(0xC0 | (codepoint >> 6)); value += static_cast<char>(0x80 | (codepoint & 0x3F)); }
                else if (codepoint <= 0xFFFF) { value += static_cast<char>(0xE0 | (codepoint >> 12)); value += static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F)); value += static_cast<char>(0x80 | (codepoint & 0x3F)); }
                else { value += static_cast<char>(0xF0 | (codepoint >> 18)); value += static_cast<char>(0x80 | ((codepoint >> 12) & 0x3F)); value += static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F)); value += static_cast<char>(0x80 | (codepoint & 0x3F)); }
            } else value += ch;
        }
        return "";
    }
    return "";
}

std::string jsonScalarField(const std::string& source, const std::string& field) {
    const std::string needle = "\"" + field + "\"";
    const auto key = source.find(needle);
    if (key == std::string::npos) return "";
    auto pos = source.find(':', key + needle.size());
    if (pos == std::string::npos) return "";
    ++pos;
    while (pos < source.size() && std::isspace(static_cast<unsigned char>(source[pos]))) ++pos;
    if (pos < source.size() && source[pos] == '"') return jsonStringField(source, field);
    const auto end = source.find_first_of(",}", pos);
    return source.substr(pos, end == std::string::npos ? std::string::npos : end - pos);
}

bool hostedMode() {
    const char* value = std::getenv("FORGEFOCUS_HOSTED");
    return value && std::string(value) == "1";
}

bool verifyGoogleIdToken(const std::string& token) {
    const std::string clientId = fileSetting("GOOGLE_CLIENT_ID", "");
    if (token.empty() || token.size() > 5000 || clientId.empty()) return false;
    int status = -1;
    const std::string response = runCurl(
        "https://oauth2.googleapis.com/tokeninfo?id_token=" + urlEncode(token), "", {}, "", status);
    if (status != 0) return false;
    const std::string issuer = jsonStringField(response, "iss");
    return jsonScalarField(response, "aud") == clientId &&
           (issuer == "https://accounts.google.com" || issuer == "accounts.google.com") &&
           jsonScalarField(response, "email_verified") == "true" &&
           !jsonStringField(response, "sub").empty();
}

struct AiCall {
    bool ready{false};
    std::string message;
    std::string provider;
    std::string notice;
    bool fallbackEligible{false};
};

std::string providerKey(const std::string& provider) {
    if (provider == "openai") return "OPENAI_API_KEY";
    if (provider == "gemini") return "GEMINI_API_KEY";
    return "";
}

std::string configuredProviderKey(const std::string& provider, const std::map<std::string, std::string>& keys) {
    const auto envName = providerKey(provider);
    if (envName.empty()) return "";
    const char* env = std::getenv(envName.c_str());
    const auto stored = keys.find(provider);
    return env && *env ? env : (stored == keys.end() ? "" : stored->second);
}

AiCall askProviderOnce(const std::string& provider, const std::string& prompt, const std::string& type,
                       const std::map<std::string, std::string>& keys, const std::string& modelOverride = "") {
    if (provider != "openai" && provider != "gemini") return {false, "Choose OpenAI or Gemini.", ""};
    const std::string key = configuredProviderKey(provider, keys);
    if (key.empty())
        return {false, "This provider is not connected. Add its API key in Render Environment.", "", "", true};

    std::string model, endpoint, request;
    std::vector<std::string> headers{"Content-Type: application/json"};
    if (provider == "gemini") {
        model = modelOverride.empty() ? fileSetting("FORGEFOCUS_GEMINI_MODEL", "gemini-3.8-flash") : modelOverride;
        endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent";
        headers.push_back("x-goog-api-key: " + key);
        request = "{\"contents\":[{\"parts\":[{\"text\":\"" + jsonEscape(prompt) + "\"}]}],\"generationConfig\":{\"temperature\":0.2,\"maxOutputTokens\":" + (type == "ask" ? "5000" : "6500") + "}}";
    } else {
        model = fileSetting("FORGEFOCUS_OPENAI_MODEL", "gpt-6.1-sol");
        endpoint = "https://api.openai.com/v1/responses";
        headers.push_back("Authorization: Bearer " + key);
        request = "{\"model\":\"" + jsonEscape(model) + "\",\"instructions\":\"You are ForgeFocus AI, a careful and accurate college teaching assistant. Follow the syllabus for course-specific answers and clearly label general background.\",\"input\":\"" + jsonEscape(prompt) + "\",\"reasoning\":{\"effort\":\"medium\"},\"max_output_tokens\":" + (type == "ask" ? "5000" : "6500") + "}";
    }
    int status = -1;
    const std::string response = runCurl(endpoint, key, headers, request, status);
    if (status != 0) {
        const auto detail = jsonStringField(response, "message");
        std::string lower = response + " " + detail;
        std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        const bool quotaOrTemporary = lower.find("429") != std::string::npos ||
            lower.find("quota") != std::string::npos || lower.find("resource_exhausted") != std::string::npos ||
            lower.find("no credits") != std::string::npos || lower.find("insufficient_quota") != std::string::npos ||
            lower.find("high demand") != std::string::npos || lower.find("overloaded") != std::string::npos ||
            lower.find("temporarily unavailable") != std::string::npos ||
            lower.find("billing_hard_limit") != std::string::npos || lower.find("rate limit") != std::string::npos ||
            lower.find("rate_limit") != std::string::npos || lower.find("500") != std::string::npos ||
            lower.find("502") != std::string::npos || lower.find("503") != std::string::npos ||
            lower.find("504") != std::string::npos || lower.find("(28)") != std::string::npos ||
            lower.find("timed out") != std::string::npos || lower.find("could not resolve") != std::string::npos;
        if (!detail.empty()) return {false, detail, "", "", quotaOrTemporary};
        if (quotaOrTemporary)
            return {false, "The provider has no available credits, reached its quota, or is temporarily unavailable.", "", "", true};
        if (response.find("401") != std::string::npos || response.find("403") != std::string::npos)
            return {false, "The AI provider rejected its API key or this key does not have access. Check the key in Render Environment.", "", "", true};
        if (response.find("404") != std::string::npos)
            return {false, "The selected AI model is unavailable for this provider account. Check the provider model setting.", "", "", true};
        return {false, "The AI provider request failed after retries. Check provider status, API key, and usage quota, then try again.", ""};
    }
    std::string text = provider == "openai" ? jsonStringField(response, "output_text") : "";
    if (text.empty()) text = jsonStringField(response, "text");
    if (text.empty()) return {false, "The AI provider returned an empty response.", "", "", true};
    return {true, text, provider};
}

bool canTryAnotherGeminiModel(const AiCall& result) {
    if (!result.fallbackEligible) return false;
    std::string message = result.message;
    std::transform(message.begin(), message.end(), message.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return message.find("high demand") != std::string::npos || message.find("overload") != std::string::npos ||
           message.find("temporarily unavailable") != std::string::npos || message.find("quota") != std::string::npos ||
           message.find("rate limit") != std::string::npos || message.find("429") != std::string::npos ||
           message.find("503") != std::string::npos || message.find("model is unavailable") != std::string::npos;
}

AiCall retryGeminiModels(AiCall result, const std::string& prompt, const std::string& type,
                         const std::map<std::string, std::string>& keys) {
    if (result.ready || !canTryAnotherGeminiModel(result)) return result;
    const auto configured = fileSetting("FORGEFOCUS_GEMINI_MODEL", "gemini-3.8-flash");
    for (const auto& model : {std::string("gemini-3.6-flash"), std::string("gemini-3.5-flash-lite")}) {
        if (model == configured) continue;
        result = askProviderOnce("gemini", prompt, type, keys, model);
        if (result.ready || !canTryAnotherGeminiModel(result)) break;
    }
    return result;
}

AiCall askProvider(const std::string& prompt, const std::string& type) {
    const auto keys = loadAiKeys();
    // Gemini analyzes every syllabus and prepares unit lessons; text Q&A prefers the stronger answer model.
    const std::string preferred = (type == "analyze" || type == "teach") ? "gemini" :
        (configuredProviderKey("openai", keys).empty() ? "gemini" : "openai");
    auto result = askProviderOnce(preferred, prompt, type, keys);
    if (!result.ready && preferred == "gemini") result = retryGeminiModels(result, prompt, type, keys);
    if (result.ready || !result.fallbackEligible) return result;
    const std::string alternate = preferred == "openai" ? "gemini" : "openai";
    if (configuredProviderKey(alternate, keys).empty()) {
        result.message += alternate == "gemini" ? " Add GEMINI_API_KEY in Render to enable the free-tier Gemini backup." : " Add OPENAI_API_KEY in Render to enable ChatGPT answers.";
        return result;
    }
    auto fallback = askProviderOnce(alternate, prompt, type, keys);
    if (!fallback.ready && alternate == "gemini") fallback = retryGeminiModels(fallback, prompt, type, keys);
    if (!fallback.ready) { fallback.message = "AI service is busy or temporarily unavailable. Please try again in a minute."; return fallback; }
    fallback.notice = "Your syllabus answer is ready.";
    return fallback;
}

std::string wikipediaContext(const std::string& question) {
    if (question.empty() || question.size() > 300) return "";
    int searchStatus = -1;
    const std::string searchUrl = "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=" +
        urlEncode(question) + "&format=json&utf8=1&srlimit=1";
    const std::string search = runCurl(searchUrl, "", {"User-Agent: ForgeFocusAI/1.0 (educational reference integration)"}, "", searchStatus);
    if (searchStatus != 0) return "";
    const std::string title = jsonStringField(search, "title");
    if (title.empty()) return "";
    std::string pageTitle = title;
    std::replace(pageTitle.begin(), pageTitle.end(), ' ', '_');
    const std::string summaryUrl = "https://en.wikipedia.org/api/rest_v1/page/summary/" + urlEncode(pageTitle);
    int summaryStatus = -1;
    const std::string summary = runCurl(summaryUrl, "", {"User-Agent: ForgeFocusAI/1.0 (educational reference integration)"}, "", summaryStatus);
    if (summaryStatus != 0) return "";
    std::string extract = jsonStringField(summary, "extract");
    const std::string canonical = jsonStringField(summary, "canonicalurl");
    if (extract.empty()) return "";
    if (extract.size() > 3000) extract.resize(3000);
    return "Wikipedia reference (verify claims; not a substitute for the syllabus):\n" + extract +
        (canonical.empty() ? "" : "\nSource: " + canonical);
}

AiCall generateStudyImage(const std::map<std::string, std::string>& fields) {
    const auto keys = loadAiKeys();
    const std::string key = configuredProviderKey("gemini", keys);
    if (key.empty()) return {false, "Gemini image generation is not connected. Add GEMINI_API_KEY in Render Environment.", "gemini"};
    const auto course = fields.count("course") && !fields.at("course").empty() ? fields.at("course") : "General education";
    const auto unit = fields.count("unitTitle") ? fields.at("unitTitle") : "";
    const auto topics = fields.count("topics") ? fields.at("topics") : "";
    const auto style = fields.count("visualType") ? fields.at("visualType") : "concept map";
    const auto syllabus = fields.count("syllabus") ? fields.at("syllabus") : "";
    const std::string prompt = "Create one polished, readable educational study visual: " + style + ". Write every visible label and explanation in the main language used by the uploaded syllabus; keep official course names, technical terms, code, and formulas unchanged where appropriate. Course: " + course +
        (unit.empty() ? " (cover the complete syllabus, organize by unit)" : "; focus on unit: " + unit) +
        ". Focus topics: " + topics + ". Use only factual concepts supported by this syllabus; preserve technical terms, spell them correctly, keep text concise and large, use a clear hierarchy, arrows/cards where helpful, high contrast, uncluttered layout, no fabricated details. "
        "This is a study aid, not a decorative poster. Syllabus: " + syllabus;
    const std::string endpoint = "https://generativelanguage.googleapis.com/v1beta/interactions";
    const std::string model = fileSetting("FORGEFOCUS_GEMINI_IMAGE_MODEL", "gemini-nano-banana-2.1");
    const std::string request = "{\"model\":\"" + jsonEscape(model) + "\",\"input\":\"" + jsonEscape(prompt) + "\",\"response_format\":{\"type\":\"image\",\"mime_type\":\"image/png\",\"aspect_ratio\":\"4:3\",\"image_size\":\"1K\"}}";
    int status = -1;
    const std::string response = runCurl(endpoint, key, {"Content-Type: application/json", "x-goog-api-key: " + key}, request, status);
    if (status != 0) {
        const auto detail = jsonStringField(response, "message");
        if (!detail.empty()) return {false, detail, "gemini"};
        if (response.find("429") != std::string::npos || response.find("quota") != std::string::npos)
            return {false, "Gemini image quota or credits are unavailable. Check Google AI Studio billing and quota.", "gemini"};
        if (response.find("401") != std::string::npos || response.find("403") != std::string::npos)
            return {false, "Gemini rejected the API key. Check GEMINI_API_KEY in Render Environment.", "gemini"};
        return {false, "Gemini could not generate the study image. Check its API key, model access, and quota.", "gemini"};
    }
    const auto image = jsonStringField(response, "data");
    if (image.empty()) return {false, "Gemini returned no image. Try a shorter syllabus or another visual style.", "gemini"};
    return {true, image, "gemini", "image/png"};
}

std::string providersJson(const std::map<std::string, std::string>& keys) {
    std::ostringstream out;
    out << '{';
    const char* names[] = {"openai", "gemini"};
    for (int i = 0; i < 2; ++i) {
        if (i) out << ',';
        const std::string envName = providerKey(names[i]);
        const char* env = std::getenv(envName.c_str());
        const auto it = keys.find(names[i]);
        out << '\"' << names[i] << "\":" << ((env && *env) || (it != keys.end() && !it->second.empty()) ? "true" : "false");
    }
    out << '}';
    return out.str();
}

std::string aiPrompt(const std::string& type, const std::map<std::string, std::string>& fields) {
    const auto course = fields.count("course") && !fields.at("course").empty() ? fields.at("course") : "General education";
    const auto syllabus = fields.count("syllabus") ? fields.at("syllabus") : "";
    const auto unit = fields.count("unitTitle") ? fields.at("unitTitle") : "";
    const auto topics = fields.count("topics") ? fields.at("topics") : "";
    const auto requestedLanguage = fields.count("answerLanguage") ? fields.at("answerLanguage") : "auto";
    const std::map<std::string, std::string> languageNames = {{"en","English"},{"ta","Tamil"},{"hi","Hindi"},{"te","Telugu"},{"kn","Kannada"},{"ml","Malayalam"},{"bn","Bengali"},{"mr","Marathi"},{"gu","Gujarati"},{"pa","Punjabi"},{"ur","Urdu"},{"ar","Arabic"},{"fr","French"},{"es","Spanish"},{"pt","Portuguese"}};
    const auto selectedLanguage = languageNames.find(requestedLanguage);
    const std::string selectedLanguageRule = selectedLanguage == languageNames.end() ? "" : "The user selected " + selectedLanguage->second + " as the answer language. Reply in " + selectedLanguage->second + " even if their question is written in a different language. ";
    const std::string languageRule = selectedLanguageRule + "LANGUAGE RULE: Unless the user selected an answer language above, reply in the language used in the user's latest request, whatever that language is. An explicit language instruction in the request takes priority over Auto. Detect the language from the request itself; do not default to English because this prompt, course name, or syllabus is in English. If the user writes Tamil in Latin letters (Tanglish), reply in natural Tanglish using Latin letters; if they write Tamil script, reply in Tamil script. Apply the same rule to every other language and script. Keep standard technical names, code, formulas, and programming keywords unchanged when appropriate. For syllabus analysis or lesson preparation where there is no natural-language question, use the main language of the uploaded syllabus while preserving official course and technical terms. ";
    if (type == "analyze") {
        return languageRule + "Analyze this course syllabus for a college faculty member who is new to teaching the subject. "
               "Return ONLY valid JSON, no markdown fences, with this shape: {\"course_title\":string,\"course_summary\":string,\"units\":[{\"title\":string,\"topics\":[string],\"learning_outcomes\":[string]}]}. "
               "Keep every unit and topic faithful to the syllabus; do not invent units. Course: " + course + "\nSYLLABUS TEXT:\n" + syllabus;
    }
    if (type == "teach") {
        return languageRule + "You are ForgeFocus AI, a patient college teaching assistant. Prepare a classroom-ready lesson for course " + course +
               ", unit " + unit + ", topics " + topics + ". Use clear headings: Learning goals, Simple explanation, Step-by-step teaching plan, Worked example, Common student confusion, Quick check questions with answers. "
               "Keep facts tied to the syllabus and label any useful background as extra context. SYLLABUS:\n" + syllabus;
    }
    const auto question = fields.count("question") ? fields.at("question") : "";
    const bool hasSyllabus = !syllabus.empty();
    return languageRule + "You are ForgeFocus AI, a capable education tutor for students and faculty across school and college subjects. Answer educational questions directly: explain concepts, solve problems step by step, give examples, explain code or calculations, make lessons, or create practice material as requested. Match the requested level; if none is stated, use clear plain language. Course context: " + course + ". "
           "First identify what the user is asking and answer that task. If they ask for test, quiz, practice, or exam questions (including informal wording like 'give 10 questions'), generate them; do not merely explain how. Use the number they request; if they ask for questions without a number, generate 10. For question sets, number each question and add a matching Answer key with a concise, clear answer for every number. Make a balanced mix of recall, understanding, and application questions when suitable. For all other requests, follow the requested format and do not turn the answer into a quiz. "
           "When the request asks about an uploaded course, a unit, its syllabus, or questions for that course, use the syllabus as the source for course-specific facts and do not invent syllabus contents. A syllabus may list a topic without teaching its definition; explain that topic using standard subject knowledge and label that explanation as extra learning context. If the user asks a broader education question, answer it using your subject knowledge even when an uploaded syllabus is present; do not refuse just because the answer is not written in the PDF. Clearly label syllabus facts versus extra learning context when both are used. "
           "When an active unit is provided and the request is about that unit, use its topics; if no unit is active, use the full syllabus only for course-specific questions. If the user asks for a diagram, include a valid Mermaid diagram inside a fenced ```mermaid code block, with labels in the selected answer language; introduce it and explain it briefly in prose. Choose a suitable flowchart, sequenceDiagram, stateDiagram-v2, or mindmap, and keep Mermaid syntax valid. Do not output a diagram code block unless a diagram is requested. "
           "ACTIVE UNIT: " + (unit.empty() ? "none" : unit) + "\nACTIVE UNIT TOPICS: " + (topics.empty() ? "none" : topics) +
           "\nUSER REQUEST: " + question + (hasSyllabus ? "\nUPLOADED SYLLABUS (for course-specific questions):\n" + syllabus : "\nNo syllabus has been uploaded. Answer as a general education tutor.");
}

Response handleRequest(const std::string& method, const std::string& rawPath, const std::string& body,
                       const std::string& authToken) {
    if (method == "OPTIONS") return {204, "No Content", "text/plain", ""};
    std::string path = rawPath;
    std::string query;
    const auto queryAt = path.find('?');
    if (queryAt != std::string::npos) {
        query = path.substr(queryAt + 1);
        path.resize(queryAt);
    }
    if (method == "GET" && path == "/health")
        return {200, "OK", "application/json; charset=utf-8", "{\"status\":\"ok\"}"};
    if (hostedMode() && path.rfind("/api/", 0) == 0) {
        if (path != "/api/ai/providers" && path != "/api/ai/keys" &&
            path != "/api/ai/analyze" && path != "/api/ai/teach" && path != "/api/ai/ask" && path != "/api/ai/visual")
            return {404, "Not Found", "application/json", "{\"error\":\"Unknown endpoint\"}"};
        if (authToken.empty() || !verifyGoogleIdToken(authToken))
            return {401, "Unauthorized", "application/json; charset=utf-8", "{\"error\":\"Please sign in with Google again\"}"};
        if (path == "/api/ai/keys")
            return {403, "Forbidden", "application/json; charset=utf-8", "{\"error\":\"AI provider keys are managed by the hosted app\"}"};
    }
    if (method == "GET") {
        if (path == "/") path = "/index.html";
        const std::map<std::string, std::string> publicFiles{
            {"/index.html", "text/html; charset=utf-8"},
            {"/style.css", "text/css; charset=utf-8"},
            {"/app.js", "application/javascript; charset=utf-8"},
            {"/config.js", "application/javascript; charset=utf-8"}
        };
        const auto asset = publicFiles.find(path);
        if (asset != publicFiles.end()) {
            if (path == "/config.js" && hostedMode()) {
                const std::string id = fileSetting("GOOGLE_CLIENT_ID", "");
                const std::string config = "window.FORGEFOCUS_CONFIG = { googleClientId: '" + id + "', hosted: true };\n";
                return {200, "OK", asset->second, config};
            }
            std::ifstream file(path.substr(1), std::ios::binary);
            if (!file) return {404, "Not Found", "text/plain; charset=utf-8", "Page file not found. Run the server from the FocusForge folder."};
            std::string content((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
            return {200, "OK", asset->second, content};
        }
    }
    if (method == "GET" && path == "/api/ai/providers")
        return {200, "OK", "application/json; charset=utf-8", providersJson(loadAiKeys())};
    if (method == "POST" && path == "/api/ai/keys") {
        auto keys = loadAiKeys();
        const auto fields = parseForm(body);
        bool changed = false;
        for (const auto& name : {"openai", "gemini"}) {
            const auto it = fields.find(name);
            if (it == fields.end() || it->second.empty()) continue;
            if (it->second.size() > 500) return {400, "Bad Request", "application/json", "{\"error\":\"An API key is too long\"}"};
            keys[name] = it->second;
            changed = true;
        }
        if (!changed) return {400, "Bad Request", "application/json", "{\"error\":\"Enter at least one API key\"}"};
        if (!saveAiKeys(keys)) return {500, "Internal Server Error", "application/json", "{\"error\":\"Could not save keys in this project folder\"}"};
        return {200, "OK", "application/json; charset=utf-8", providersJson(keys)};
    }
    if (method == "POST" && (path == "/api/ai/analyze" || path == "/api/ai/teach" || path == "/api/ai/ask" || path == "/api/ai/visual")) {
        const auto fields = parseForm(body);
        const std::string type = path.substr(std::string("/api/ai/").size());
        const std::string syllabus = fields.count("syllabus") ? fields.at("syllabus") : "";
        const std::string course = fields.count("course") ? fields.at("course") : "";
        if ((course.empty() && type != "ask") || course.size() > 160)
            return {400, "Bad Request", "application/json", "{\"error\":\"Enter a course name up to 160 characters\"}"};
        if ((type != "ask" && syllabus.size() < 80) || syllabus.size() > 100000)
            return {400, "Bad Request", "application/json", "{\"error\":\"Syllabus text is empty or too large. Choose a text-based PDF under 20 MB\"}"};
        if (type == "visual") {
            const std::string visualType = fields.count("visualType") ? fields.at("visualType") : "concept map";
            if (visualType != "concept map" && visualType != "sticky notes" && visualType != "flowchart")
                return {400, "Bad Request", "application/json", "{\"error\":\"Choose a concept map, sticky notes, or flowchart\"}"};
            auto result = generateStudyImage(fields);
            if (!result.ready) return {502, "Bad Gateway", "application/json; charset=utf-8", "{\"error\":\"" + jsonEscape(result.message) + "\"}"};
            return {200, "OK", "application/json; charset=utf-8", "{\"image\":\"" + result.message + "\",\"mimeType\":\"image/png\",\"provider\":\"AI\"}"};
        }
        if (type == "teach" && (!fields.count("unitTitle") || fields.at("unitTitle").empty()))
            return {400, "Bad Request", "application/json", "{\"error\":\"Choose a course unit to prepare\"}"};
        if (type == "ask" && (!fields.count("question") || fields.at("question").empty() || fields.at("question").size() > 2500))
            return {400, "Bad Request", "application/json", "{\"error\":\"Enter a question up to 2500 characters\"}"};
        std::string prompt = aiPrompt(type, fields);
        std::string wikiSource;
        if (type == "ask" && fields.count("wikipediaOptIn") && fields.at("wikipediaOptIn") == "yes" &&
            (!fields.count("unitTitle") || fields.at("unitTitle").empty())) {
            const auto question = fields.at("question");
            std::string lower = question;
            std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
            const bool quizRequest = lower.find("question") != std::string::npos || lower.find("quiz") != std::string::npos ||
                lower.find("test") != std::string::npos || lower.find("exam") != std::string::npos || lower.find("practice") != std::string::npos;
            if (!quizRequest) {
                wikiSource = wikipediaContext(question);
                if (!wikiSource.empty()) prompt += "\n\nOPTIONAL GENERAL KNOWLEDGE SOURCE (Wikipedia):\n" + wikiSource +
                    "\nUse this reference only for general context beyond the uploaded syllabus. The syllabus remains authoritative for course questions. Cite the Wikipedia page URL if you use it.";
            }
        }
        auto result = askProvider(prompt, type);
        if (!result.ready)
            return {502, "Bad Gateway", "application/json; charset=utf-8", "{\"error\":\"" + jsonEscape(result.message) + "\"}"};
        const std::string notice = wikiSource.empty() ? result.notice : "Wikipedia reference added for general knowledge.";
        return {200, "OK", "application/json; charset=utf-8", "{\"text\":\"" + jsonEscape(result.message) + "\",\"provider\":\"AI\",\"notice\":\"" + jsonEscape(notice) + "\"}"};
    }
    if (method == "GET" && path == "/api/study/state") {
        const auto queryFields = parseForm(query);
        const std::string profile = queryFields.count("profile") ? queryFields.at("profile") : "local";
        if (studyDataFile(profile).empty()) return {400, "Bad Request", "application/json", "{\"error\":\"Invalid student profile\"}"};
        auto state = loadStudyState(profile);
        return {200, "OK", "application/json; charset=utf-8", studyJson(state)};
    }
    if (method == "POST" && path == "/api/study/session") {
        const auto fields = parseForm(body);
        if (!fields.count("minutes"))
            return {400, "Bad Request", "application/json", "{\"error\":\"Session minutes are required\"}"};
        const std::string profile = fields.count("profile") ? fields.at("profile") : "local";
        if (studyDataFile(profile).empty()) return {400, "Bad Request", "application/json", "{\"error\":\"Invalid student profile\"}"};
        int minutes = 0;
        try { minutes = std::stoi(fields.at("minutes")); }
        catch (...) { return {400, "Bad Request", "application/json", "{\"error\":\"Invalid session length\"}"}; }
        if (minutes < 1 || minutes > 50)
            return {400, "Bad Request", "application/json", "{\"error\":\"Session length must be from 1 to 50 minutes\"}"};
        auto state = loadStudyState(profile);
        state.sessions++;
        state.xp += minutes * 2;
        state.dailyXp += minutes * 2;
        if (state.sessions >= 2 && !(state.questMask & 2)) {
            state.questMask |= 2;
            state.xp += 100;
            state.dailyXp += 100;
        }
        saveStudyState(state, profile);
        return {200, "OK", "application/json; charset=utf-8", studyJson(state)};
    }
    if (method == "POST" && path == "/api/study/quest") {
        const auto fields = parseForm(body);
        if (!fields.count("id"))
            return {400, "Bad Request", "application/json", "{\"error\":\"Quest id is required\"}"};
        const std::string profile = fields.count("profile") ? fields.at("profile") : "local";
        if (studyDataFile(profile).empty()) return {400, "Bad Request", "application/json", "{\"error\":\"Invalid student profile\"}"};
        const std::map<std::string, int> questBits{{"wake", 1}, {"sessions", 2}, {"practice", 4}, {"revise", 8}};
        const auto found = questBits.find(fields.at("id"));
        if (found == questBits.end())
            return {400, "Bad Request", "application/json", "{\"error\":\"Unknown quest\"}"};
        auto state = loadStudyState(profile);
        if (fields.at("id") == "sessions" && state.sessions < 2)
            return {400, "Bad Request", "application/json", "{\"error\":\"Complete two focus sessions first\"}"};
        if (!(state.questMask & found->second)) {
            state.questMask |= found->second;
            const int reward = fields.at("id") == "wake" ? 50 : fields.at("id") == "practice" ? 80 : fields.at("id") == "revise" ? 70 : 100;
            state.xp += reward;
            state.dailyXp += reward;
        }
        saveStudyState(state, profile);
        return {200, "OK", "application/json; charset=utf-8", studyJson(state)};
    }
    if (method == "POST" && path == "/api/study/game") {
        const auto fields = parseForm(body);
        if (!fields.count("game") || !fields.count("correct"))
            return {400, "Bad Request", "application/json", "{\"error\":\"Game result details are required\"}"};
        const std::string profile = fields.count("profile") ? fields.at("profile") : "local";
        if (studyDataFile(profile).empty()) return {400, "Bad Request", "application/json", "{\"error\":\"Invalid student profile\"}"};
        const auto game = fields.at("game");
        if (game != "memory" && game != "pattern" && game != "math")
            return {400, "Bad Request", "application/json", "{\"error\":\"Unknown brain-training game\"}"};
        auto state = loadStudyState(profile);
        state.gamesPlayed++;
        if (fields.at("correct") == "true") {
            const int reward = game == "memory" ? 20 : 15;
            state.xp += reward;
            state.dailyXp += reward;
        }
        saveStudyState(state, profile);
        return {200, "OK", "application/json; charset=utf-8", studyJson(state)};
    }
    auto tasks = loadTasks();

    if (method == "GET" && path == "/api/game/profile")
        return {200, "OK", "application/json; charset=utf-8", profileJson(loadProfile())};

    if (method == "POST" && path == "/api/game/save") {
        const auto profile = loadProfile();
        saveProfile(profile);
        return {200, "OK", "application/json; charset=utf-8", profileJson(profile)};
    }

    if (method == "POST" && path == "/api/game/new") {
        auto profile = loadProfile();
        profile.level = 1;
        profile.paceMs = 360;
        saveProfile(profile);
        return {200, "OK", "application/json; charset=utf-8", profileJson(profile)};
    }

    if (method == "POST" && path == "/api/game/result") {
        const auto fields = parseForm(body);
        if (!fields.count("correct") || !fields.count("responseMs") || !fields.count("sequenceLength"))
            return {400, "Bad Request", "application/json", "{\"error\":\"Missing game result details\"}"};
        int responseMs = 0, sequenceLength = 0;
        try {
            responseMs = std::stoi(fields.at("responseMs"));
            sequenceLength = std::stoi(fields.at("sequenceLength"));
        } catch (...) {
            return {400, "Bad Request", "application/json", "{\"error\":\"Invalid game result details\"}"};
        }
        if (responseMs < 0 || sequenceLength < 1 || sequenceLength > 10)
            return {400, "Bad Request", "application/json", "{\"error\":\"Game result is out of range\"}"};

        auto profile = loadProfile();
        const bool correct = fields.at("correct") == "true";
        const bool practice = fields.count("practice") && fields.at("practice") == "true";
        const bool fast = responseMs <= sequenceLength * 1500;
        std::string feedback;
        if (practice) {
            if (correct && fast) profile.paceMs = std::max(220, profile.paceMs - 20);
            else if (!correct) profile.paceMs = std::min(440, profile.paceMs + 20);
            feedback = correct ? "Practice clear saved. Your unlocked level stays ready." : "Practice saved. Try the sequence again whenever you like.";
        } else if (correct) {
            profile.level = std::min(8, profile.level + 1);
            if (fast) {
                profile.paceMs = std::max(220, profile.paceMs - 20);
                feedback = "Quick clear! The next level is ready, with a slightly faster sequence.";
            } else {
                feedback = "Level cleared! Your next sequence is ready.";
            }
        } else {
            profile.paceMs = std::min(440, profile.paceMs + 20);
            feedback = "Same level ready to retry. The sequence will play a little slower.";
        }
        profile.bestLevel = std::max(profile.bestLevel, profile.level);
        saveProfile(profile);
        auto json = profileJson(profile);
        json.pop_back();
        json += ",\"feedback\":\"" + feedback + "\"}";
        return {200, "OK", "application/json; charset=utf-8", json};
    }

    if (method == "GET" && path == "/api/settings")
        return {200, "OK", "application/json; charset=utf-8",
                "{\"dailyHours\":" + std::to_string(loadDailyHours()) + "}"};

    if (method == "POST" && path == "/api/settings") {
        const auto fields = parseForm(body);
        if (!fields.count("dailyHours"))
            return {400, "Bad Request", "application/json", "{\"error\":\"Enter your daily study hours\"}"};
        int hours = 0;
        try {
            std::size_t parsed = 0;
            hours = std::stoi(fields.at("dailyHours"), &parsed);
            if (parsed != fields.at("dailyHours").size()) throw std::invalid_argument("not a whole number");
        } catch (...) {
            return {400, "Bad Request", "application/json", "{\"error\":\"Daily hours must be a whole number\"}"};
        }
        if (hours < 1 || hours > 24)
            return {400, "Bad Request", "application/json", "{\"error\":\"Choose between 1 and 24 hours per day\"}"};
        saveDailyHours(hours);
        return {200, "OK", "application/json; charset=utf-8",
                "{\"dailyHours\":" + std::to_string(hours) + "}"};
    }

    if (method == "GET" && path == "/api/tasks")
        return {200, "OK", "application/json; charset=utf-8", tasksJson(tasks)};

    if (method == "POST" && path == "/api/tasks") {
        const auto fields = parseForm(body);
        if (!fields.count("title") || !fields.count("subject") || !fields.count("days") || !fields.count("hours"))
            return {400, "Bad Request", "application/json", "{\"error\":\"Missing task details\"}"};
        int days = 0, hours = 0;
        try { days = std::stoi(fields.at("days")); hours = std::stoi(fields.at("hours")); }
        catch (...) { return {400, "Bad Request", "application/json", "{\"error\":\"Days and hours must be numbers\"}"}; }
        if (fields.at("title").empty() || fields.at("subject").empty() || days < 0 || hours < 1)
            return {400, "Bad Request", "application/json", "{\"error\":\"Enter a task, subject, valid deadline, and at least one hour\"}"};
        int nextId = 1;
        for (const auto& task : tasks) nextId = std::max(nextId, task.id + 1);
        tasks.push_back({nextId, fields.at("title"), fields.at("subject"), days, hours, false});
        saveTasks(tasks);
        return {201, "Created", "application/json; charset=utf-8", tasksJson(tasks)};
    }

    const std::string prefix = "/api/tasks/";
    const std::string suffix = "/status";
    if (method == "POST" && path.rfind(prefix, 0) == 0 && path.size() > prefix.size() + suffix.size() &&
        path.compare(path.size() - suffix.size(), suffix.size(), suffix) == 0) {
        const auto idText = path.substr(prefix.size(), path.size() - prefix.size() - suffix.size());
        int id = 0;
        try { id = std::stoi(idText); } catch (...) { id = 0; }
        const auto fields = parseForm(body);
        const bool completed = fields.count("completed") && fields.at("completed") == "true";
        auto found = std::find_if(tasks.begin(), tasks.end(), [id](const Task& task) { return task.id == id; });
        if (found == tasks.end()) return {404, "Not Found", "application/json", "{\"error\":\"Task not found\"}"};
        found->completed = completed;
        saveTasks(tasks);
        return {200, "OK", "application/json; charset=utf-8", tasksJson(tasks)};
    }

    return {404, "Not Found", "application/json", "{\"error\":\"Unknown endpoint\"}"};
}

void sendAll(int socket, const std::string& data) {
    std::size_t sent = 0;
    while (sent < data.size()) {
        const auto count = send(socket, data.data() + sent, data.size() - sent, 0);
        if (count <= 0) return;
        sent += static_cast<std::size_t>(count);
    }
}

void serveClient(int client) {
    std::string request;
    char buffer[4096];
    std::size_t headerEnd = std::string::npos;
    std::size_t contentLength = 0;
    std::string authToken;
    while (request.size() < 600000) {
        const auto count = recv(client, buffer, sizeof(buffer), 0);
        if (count <= 0) break;
        request.append(buffer, static_cast<std::size_t>(count));
        if (headerEnd == std::string::npos) {
            headerEnd = request.find("\r\n\r\n");
            if (headerEnd != std::string::npos) {
                std::istringstream headers(request.substr(0, headerEnd));
                std::string line;
                std::getline(headers, line);
                while (std::getline(headers, line)) {
                    if (line.size() >= 15 && line.substr(0, 15) == "Content-Length:")
                        contentLength = static_cast<std::size_t>(std::stoul(line.substr(15)));
                    const auto colon = line.find(':');
                    if (colon != std::string::npos) {
                        std::string name = line.substr(0, colon);
                        std::transform(name.begin(), name.end(), name.begin(), [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
                        if (name == "authorization") {
                            std::string value = line.substr(colon + 1);
                            while (!value.empty() && std::isspace(static_cast<unsigned char>(value.front()))) value.erase(value.begin());
                            if (value.rfind("Bearer ", 0) == 0) authToken = value.substr(7);
                            while (!authToken.empty() && std::isspace(static_cast<unsigned char>(authToken.back()))) authToken.pop_back();
                        }
                    }
                }
            }
        }
        if (headerEnd != std::string::npos && request.size() >= headerEnd + 4 + contentLength) break;
    }

    Response response{400, "Bad Request", "application/json", "{\"error\":\"Invalid request\"}"};
    if (contentLength > 550000) {
        response = {413, "Payload Too Large", "application/json", "{\"error\":\"Request exceeds the 550 KB limit\"}"};
    }
    if (headerEnd != std::string::npos && contentLength <= 550000) {
        std::istringstream headers(request.substr(0, headerEnd));
        std::string requestLine;
        std::getline(headers, requestLine);
        std::istringstream firstLine(requestLine);
        std::string method, path, version;
        firstLine >> method >> path >> version;
        const auto bodyStart = headerEnd + 4;
        const std::string body = request.substr(bodyStart, std::min(contentLength, request.size() - bodyStart));
        response = handleRequest(method, path, body, authToken);
    }

    std::ostringstream result;
    result << "HTTP/1.1 " << response.status << ' ' << response.label << "\r\n"
           << "Content-Type: " << response.type << "\r\n"
           << "Cache-Control: no-store\r\n"
           << "Content-Length: " << response.body.size() << "\r\n"
           << "Connection: close\r\n\r\n" << response.body;
    sendAll(client, result.str());
}

int main() {
    const int server = socket(AF_INET, SOCK_STREAM, 0);
    if (server < 0) { std::cerr << "Could not create the local server socket.\n"; return 1; }
    int reuse = 1;
    setsockopt(server, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));

    sockaddr_in address{};
    address.sin_family = AF_INET;
    int port = 8080;
    if (const char* configuredPort = std::getenv("PORT")) {
        try { port = std::stoi(configuredPort); } catch (...) { port = 8080; }
    }
    if (port < 1 || port > 65535) port = 8080;
    address.sin_port = htons(static_cast<uint16_t>(port));
    address.sin_addr.s_addr = htonl(hostedMode() ? INADDR_ANY : INADDR_LOOPBACK);
    if (bind(server, reinterpret_cast<sockaddr*>(&address), sizeof(address)) < 0) {
        std::cerr << "Could not use port 8080. Close any other FocusForge server and try again.\n";
        close(server);
        return 1;
    }
    if (listen(server, 10) < 0) { std::cerr << "Could not start listening.\n"; close(server); return 1; }

    std::cout << "FocusForge C++ backend running on port " << port << "\n";
    while (true) {
        const int client = accept(server, nullptr, nullptr);
        if (client < 0) continue;
        std::thread([client] { serveClient(client); close(client); }).detach();
    }
}
