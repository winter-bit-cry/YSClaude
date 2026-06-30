package com.ysclaude.app

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.jcraft.jsch.ChannelExec
import com.jcraft.jsch.JSch
import com.jcraft.jsch.Session
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.nio.charset.StandardCharsets
import java.util.Properties
import java.util.UUID

class RemoteSshCommandModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "RemoteSshCommand"

  private val keepAliveIntervalMs = 15000
  private val keepAliveCountMax = 4
  private val lock = Any()
  private var persistentSession: PersistentSshSession? = null

  @ReactMethod
  fun connect(config: ReadableMap, promise: Promise) {
    Thread {
      try {
        val result = synchronized(lock) {
          connectLocked(config)
        }
        promise.resolve(result)
      } catch (error: Exception) {
        promise.reject("REMOTE_SSH_CONNECT_FAILED", error)
      }
    }.start()
  }

  @ReactMethod
  fun command(config: ReadableMap, promise: Promise) {
    Thread {
      try {
        val result = synchronized(lock) {
          var ssh = persistentSession
          if (ssh == null || !ssh.isConnected()) {
            ssh = if (config.getBooleanValue("autoReconnect", false) && hasConnectionConfig(config)) {
              connectLocked(config)
              persistentSession
            } else {
              null
            }
          }
          if (ssh == null || !ssh.isConnected()) {
            throw IllegalStateException("SSH session is not connected. Call ssh_connect first.")
          }

          val command = config.getStringValue("command").trim()
          val timeoutMs = config.getIntValue("timeoutMs", 60000).coerceAtLeast(1000)
          val maxOutputChars = config.getIntValue("maxOutputChars", 20000).coerceIn(1000, 500000)
          val autoReconnect = config.getBooleanValue("autoReconnect", false) && hasConnectionConfig(config)
          try {
            runStatefulCommandLocked(ssh, command, timeoutMs, maxOutputChars, retriedAfterReconnect = false)
          } catch (firstError: Exception) {
            if (!autoReconnect) {
              throw firstError
            }
            val firstMessage = firstError.message ?: firstError.javaClass.simpleName
            closeSessionLocked(cleanRemoteState = false, lastError = "command failed before reconnect: $firstMessage")
            connectLocked(config)
            val reconnected = persistentSession
              ?: throw IllegalStateException("SSH reconnect failed after command error: $firstMessage")
            runStatefulCommandLocked(reconnected, command, timeoutMs, maxOutputChars, retriedAfterReconnect = true).apply {
              putString("reconnect_reason", firstMessage)
            }
          }
        }
        promise.resolve(result)
      } catch (error: Exception) {
        promise.reject("REMOTE_SSH_COMMAND_FAILED", error)
      }
    }.start()
  }

  @ReactMethod
  fun status(promise: Promise) {
    Thread {
      try {
        val result = synchronized(lock) {
          val ssh = persistentSession
          if (ssh?.isConnected() == true) {
            try {
              execLocked(ssh.session, buildRemoteShellCommand(":"), 3000, 1000)
              ssh.markActivity()
              ssh.statusMap("connected")
            } catch (error: Exception) {
              val message = error.message ?: error.javaClass.simpleName
              closeSessionLocked(cleanRemoteState = false, lastError = "status probe failed: $message")
              disconnectedStatusMap("disconnected", message)
            }
          } else {
            disconnectedStatusMap("disconnected", persistentSession?.lastError)
          }
        }
        promise.resolve(result)
      } catch (error: Exception) {
        promise.reject("REMOTE_SSH_STATUS_FAILED", error)
      }
    }.start()
  }

  @ReactMethod
  fun close(promise: Promise) {
    Thread {
      try {
        val result = synchronized(lock) {
          val wasConnected = persistentSession?.isConnected() == true
          closeSessionLocked(cleanRemoteState = true)
          Arguments.createMap().apply {
            putBoolean("closed", true)
            putBoolean("was_connected", wasConnected)
          }
        }
        promise.resolve(result)
      } catch (error: Exception) {
        promise.reject("REMOTE_SSH_CLOSE_FAILED", error)
      }
    }.start()
  }

  private fun connectLocked(config: ReadableMap): com.facebook.react.bridge.WritableMap {
    val reconnect = config.getBooleanValue("reconnect", false)
    val existing = persistentSession
    if (!reconnect && existing?.isConnected() == true) {
      return existing.statusMap("already_connected")
    }
    closeSessionLocked(cleanRemoteState = true, lastError = null)

    val host = config.getStringValue("host").trim()
    val username = config.getStringValue("username").trim()
    if (host.isEmpty()) throw IllegalArgumentException("SSH host is required")
    if (username.isEmpty()) throw IllegalArgumentException("SSH username is required")

    val port = config.getIntValue("port", 22).coerceIn(1, 65535)
    val timeoutMs = config.getIntValue("timeoutMs", 60000).coerceAtLeast(1000)
    val maxOutputChars = config.getIntValue("maxOutputChars", 20000).coerceIn(1000, 500000)
    val password = config.getOptionalString("password")
    val privateKey = config.getOptionalString("privateKey")
    val passphrase = config.getOptionalString("passphrase")
    val cwd = config.getOptionalString("cwd")?.trim().orEmpty()
    val strictHostKeyChecking = config.getBooleanValue("strictHostKeyChecking", false)
    val knownHosts = config.getOptionalString("knownHosts")

    val jsch = JSch()
    if (!knownHosts.isNullOrBlank()) {
      jsch.setKnownHosts(ByteArrayInputStream(knownHosts.toByteArray(StandardCharsets.UTF_8)))
    }
    if (!privateKey.isNullOrBlank()) {
      jsch.addIdentity(
        "ysclaude-remote-ssh-key",
        privateKey.toByteArray(StandardCharsets.UTF_8),
        null,
        passphrase?.toByteArray(StandardCharsets.UTF_8)
      )
    }

    val session = jsch.getSession(username, host, port)
    if (!password.isNullOrEmpty()) {
      session.setPassword(password)
    }
    session.setConfig(buildSessionProperties(privateKey, password, strictHostKeyChecking))
    session.serverAliveInterval = keepAliveIntervalMs
    session.serverAliveCountMax = keepAliveCountMax
    session.connect(timeoutMs)

    val sessionId = UUID.randomUUID().toString().replace("-", "")
    val stateDir = "\${TMPDIR:-/tmp}/ysclaude-ssh-$sessionId"
    val initialCwd = cwd.ifEmpty { "." }
    val initScript = """
      set -eu
      mkdir -p "$stateDir"
      cd -- ${shellQuote(initialCwd)}
      pwd > "$stateDir/cwd"
      export -p > "$stateDir/env" 2>/dev/null || true
      printf '%s\n' "$stateDir"
    """.trimIndent()
    val initResult = execLocked(session, buildRemoteShellCommand(initScript), timeoutMs, maxOutputChars)
    if (initResult.exitCode != 0) {
      try {
        session.disconnect()
      } catch (_: Exception) {
      }
      throw IllegalStateException("SSH state init failed: ${initResult.stderr.ifEmpty { initResult.stdout }}")
    }

    val remoteStateDir = initResult.stdout.trim().ifEmpty { stateDir }
    val ssh = PersistentSshSession(
      sessionId = sessionId,
      host = host,
      port = port,
      username = username,
      session = session,
      stateDir = remoteStateDir,
      connectedAt = System.currentTimeMillis()
    )
    persistentSession = ssh

    return ssh.statusMap("connected").apply {
      putString("state_dir", remoteStateDir)
      putString("cwd", initialCwd)
      putString("mode", "persistent_transport_stateful_exec")
    }
  }

  private fun runStatefulCommandLocked(
    ssh: PersistentSshSession,
    command: String,
    timeoutMs: Int,
    maxOutputChars: Int,
    retriedAfterReconnect: Boolean
  ): com.facebook.react.bridge.WritableMap {
    if (command.isEmpty()) throw IllegalArgumentException("SSH command is required")

    val script = """
      set +e
      STATE_DIR=${shellQuote(ssh.stateDir)}
      CWD_FILE="${'$'}STATE_DIR/cwd"
      ENV_FILE="${'$'}STATE_DIR/env"
      [ -f "${'$'}ENV_FILE" ] && . "${'$'}ENV_FILE"
      if [ -f "${'$'}CWD_FILE" ]; then
        cd -- "${'$'}(cat "${'$'}CWD_FILE")" 2>/dev/null || true
      fi
      {
      $command
      }
      __ysclaude_status=${'$'}?
      pwd > "${'$'}CWD_FILE" 2>/dev/null || true
      export -p > "${'$'}ENV_FILE" 2>/dev/null || true
      exit "${'$'}__ysclaude_status"
    """.trimIndent()

    val startedAt = System.currentTimeMillis()
    val result = execLocked(ssh.session, buildRemoteShellCommand(script), timeoutMs, maxOutputChars)
    ssh.markActivity()
    return Arguments.createMap().apply {
      putInt("exit_code", result.exitCode)
      putBoolean("timed_out", result.timedOut)
      putDouble("duration_ms", (System.currentTimeMillis() - startedAt).toDouble())
      putString("stdout", result.stdout)
      putString("stderr", result.stderr)
      putString("session_id", ssh.sessionId)
      putString("host", ssh.host)
      putInt("port", ssh.port)
      putString("username", ssh.username)
      putBoolean("session_connected", ssh.isConnected())
      putBoolean("retried_after_reconnect", retriedAfterReconnect)
      putString("mode", "persistent_transport_stateful_exec")
    }
  }

  private fun execLocked(
    session: Session,
    command: String,
    timeoutMs: Int,
    maxOutputChars: Int
  ): ExecResult {
    val startedAt = System.currentTimeMillis()
    val channel = session.openChannel("exec") as ChannelExec
    val stdout = ByteArrayOutputStream()
    val stderr = ByteArrayOutputStream()
    val outputLimitBytes = maxOutputChars * 4
    var timedOut = false
    var exitCode = -1

    try {
      channel.setCommand(command)
      channel.setInputStream(null)
      val stdoutStream = channel.inputStream
      val stderrStream = channel.errStream
      channel.connect(timeoutMs.coerceAtMost(30000))

      val deadline = startedAt + timeoutMs
      while (true) {
        drainAvailable(stdoutStream, stdout, outputLimitBytes)
        drainAvailable(stderrStream, stderr, outputLimitBytes)
        if (channel.isClosed) {
          exitCode = channel.exitStatus
          break
        }
        if (System.currentTimeMillis() > deadline) {
          timedOut = true
          channel.disconnect()
          break
        }
        Thread.sleep(40)
      }
      drainAvailable(stdoutStream, stdout, outputLimitBytes)
      drainAvailable(stderrStream, stderr, outputLimitBytes)
    } finally {
      try {
        channel.disconnect()
      } catch (_: Exception) {
      }
    }

    return ExecResult(
      exitCode = exitCode,
      timedOut = timedOut,
      stdout = truncateOutput(stdout.toString(StandardCharsets.UTF_8.name()), maxOutputChars),
      stderr = truncateOutput(stderr.toString(StandardCharsets.UTF_8.name()), maxOutputChars)
    )
  }

  private fun buildSessionProperties(
    privateKey: String?,
    password: String?,
    strictHostKeyChecking: Boolean
  ): Properties {
    val props = Properties()
    props["StrictHostKeyChecking"] = if (strictHostKeyChecking) "yes" else "no"
    props["PreferredAuthentications"] =
      if (!privateKey.isNullOrBlank() && !password.isNullOrEmpty()) {
        "publickey,password,keyboard-interactive"
      } else if (!privateKey.isNullOrBlank()) {
        "publickey"
      } else {
        "password,keyboard-interactive"
      }
    return props
  }

  private fun closeSessionLocked(cleanRemoteState: Boolean, lastError: String? = null) {
    val ssh = persistentSession
    if (cleanRemoteState && ssh?.isConnected() == true) {
      try {
        execLocked(ssh.session, "rm -rf -- ${shellQuote(ssh.stateDir)}", 3000, 1000)
      } catch (_: Exception) {
      }
    }
    ssh?.close()
    ssh?.lastError = lastError
    persistentSession = null
  }

  private fun drainAvailable(input: InputStream, output: ByteArrayOutputStream, limitBytes: Int) {
    val buffer = ByteArray(4096)
    while (input.available() > 0) {
      val read = input.read(buffer, 0, minOf(buffer.size, input.available()))
      if (read <= 0) return
      if (output.size() < limitBytes) {
        output.write(buffer, 0, minOf(read, limitBytes - output.size()))
      }
    }
  }

  private fun truncateOutput(output: String, maxOutputChars: Int): String {
    if (output.length <= maxOutputChars) return output
    val omitted = output.length - maxOutputChars
    return "${output.take(maxOutputChars)}\n\n[输出已截断，省略 ${omitted} 个字符]"
  }

  private fun shellQuote(value: String): String {
    return "'" + value.replace("'", "'\"'\"'") + "'"
  }

  private fun buildRemoteShellCommand(script: String): String {
    val quotedScript = shellQuote(script)
    return "if command -v bash >/dev/null 2>&1; then bash -c $quotedScript; else sh -c $quotedScript; fi"
  }

  private fun disconnectedStatusMap(status: String, lastError: String?): com.facebook.react.bridge.WritableMap {
    return Arguments.createMap().apply {
      putString("status", status)
      putBoolean("session_connected", false)
      if (!lastError.isNullOrBlank()) {
        putString("last_error", lastError)
      }
    }
  }

  private fun hasConnectionConfig(config: ReadableMap): Boolean {
    return config.getStringValue("host").trim().isNotEmpty() &&
      config.getStringValue("username").trim().isNotEmpty()
  }

  private fun ReadableMap.getStringValue(name: String): String {
    return if (hasKey(name) && !isNull(name)) getString(name) ?: "" else ""
  }

  private fun ReadableMap.getOptionalString(name: String): String? {
    return if (hasKey(name) && !isNull(name)) getString(name) else null
  }

  private fun ReadableMap.getIntValue(name: String, fallback: Int): Int {
    return if (hasKey(name) && !isNull(name)) getDouble(name).toInt() else fallback
  }

  private fun ReadableMap.getBooleanValue(name: String, fallback: Boolean): Boolean {
    return if (hasKey(name) && !isNull(name)) getBoolean(name) else fallback
  }

  private data class ExecResult(
    val exitCode: Int,
    val timedOut: Boolean,
    val stdout: String,
    val stderr: String,
  )

  private class PersistentSshSession(
    val sessionId: String,
    val host: String,
    val port: Int,
    val username: String,
    val session: Session,
    val stateDir: String,
    val connectedAt: Long,
    var lastActivityAt: Long = connectedAt,
    var lastError: String? = null,
  ) {
    fun isConnected(): Boolean {
      return session.isConnected
    }

    fun close() {
      try {
        session.disconnect()
      } catch (_: Exception) {
      }
    }

    fun markActivity() {
      lastActivityAt = System.currentTimeMillis()
      lastError = null
    }

    fun statusMap(status: String): com.facebook.react.bridge.WritableMap {
      return Arguments.createMap().apply {
        putString("status", status)
        putString("session_id", sessionId)
        putString("host", host)
        putInt("port", port)
        putString("username", username)
        putBoolean("session_connected", isConnected())
        putDouble("connected_at", connectedAt.toDouble())
        putDouble("last_activity_at", lastActivityAt.toDouble())
        if (!lastError.isNullOrBlank()) {
          putString("last_error", lastError)
        }
        putString("mode", "persistent_transport_stateful_exec")
      }
    }
  }
}
