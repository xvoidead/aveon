package com.aveon.player.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.aveon.player.Engine
import com.aveon.player.Panel
import com.aveon.player.str
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import kotlin.math.cos
import kotlin.math.sin

// Вход и регистрация в стиле Apple: значок, крупный заголовок, поля одной сгруппированной плашкой,
// большая кнопка. Логика — та же форма движка (app.js), сюда приходят её тексты и ошибки (native.js → authData).
// Сброс пароля — те же шаги, что на компьютере: «логин или почта» → шесть цифр из письма → новый пароль.

private val AUTH_STEPS = listOf("login", "register", "forgot", "code", "newpass")
private val RESET_STEPS = setOf("forgot", "code", "newpass")
private val OkGreen = Color(0xFF34C759)

@Composable
fun AuthScreen(panel: Panel) {
    val p = LocalPal.current
    var d by remember { mutableStateOf<JSONObject?>(null) }
    LaunchedEffect(panel) { d = Engine.obj("authData") }
    val data = d
    var login by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var pass2 by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var show by remember { mutableStateOf(false) }
    var inited by remember { mutableStateOf(false) }
    LaunchedEffect(data) {
        if (data != null && !inited) { login = data.str("login"); inited = true }
    }
    val mode = data?.str("mode")?.ifEmpty { null } ?: "login"
    val reg = mode == "register"
    val forgot = mode == "forgot"
    val codeStep = mode == "code"
    val newpass = mode == "newpass"
    val showLogin = data?.optBoolean("showLogin", true) ?: true
    val showPass = data?.optBoolean("showPass", true) ?: true
    val showPass2 = data?.optBoolean("showPass2", reg) ?: false
    val showGo = data?.optBoolean("showGo", true) ?: true
    val showForgot = data?.optBoolean("showForgot") == true
    val codeState = data?.str("codeState") ?: ""
    val busy = data?.optBoolean("busy") == true
    val error = data?.str("error") ?: ""
    val focus = LocalFocusManager.current
    val fLogin = remember { FocusRequester() }
    val fPass = remember { FocusRequester() }
    val fPass2 = remember { FocusRequester() }
    val fCode = remember { FocusRequester() }
    fun submit() {
        if (busy || codeStep) return
        focus.clearFocus()
        Engine.send("authSubmit", "", login, pass, pass2)
    }
    // ошибка — кнопка вздрагивает, как поле пароля в iOS (у кода трясутся сами ячейки)
    val shake = remember { Animatable(0f) }
    LaunchedEffect(error) {
        if (error.isNotEmpty() && !codeStep) for (x in listOf(14f, -12f, 9f, -6f, 3f, 0f)) shake.animateTo(x, tween(55))
    }

    // шаги сброса сменяют друг друга сдвигом: вперёд — новый въезжает справа, назад — слева (как stepTo в app.js)
    val slide = remember { Animatable(0f) }
    val fade = remember { Animatable(1f) }
    var prevMode by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(mode) {
        val was = prevMode
        prevMode = mode
        if (was == null || was == mode) return@LaunchedEffect
        if (newpass) { pass = ""; pass2 = ""; show = false }
        if (codeStep) code = ""
        try {
            when (mode) {
                "code" -> fCode.requestFocus()
                "newpass" -> fPass.requestFocus()
                "forgot", "register" -> fLogin.requestFocus()
            }
        } catch (_: Exception) {}
        if (mode !in RESET_STEPS && was !in RESET_STEPS) return@LaunchedEffect
        val dir = if (AUTH_STEPS.indexOf(mode) >= AUTH_STEPS.indexOf(was)) 1f else -1f
        slide.snapTo(28f * dir)
        fade.snapTo(0f)
        launch { slide.animateTo(0f, spring(dampingRatio = 0.85f, stiffness = 380f)) }
        fade.animateTo(1f, tween(260))
    }
    // ячейки кода: пришли к шагу или попросили новый код — пусто; сервер ответил и app.js стёр код — стираем и мы
    var codeEnter by remember { mutableIntStateOf(0) }
    var prevCodeState by remember { mutableStateOf("") }
    LaunchedEffect(codeState) {
        val was = prevCodeState
        prevCodeState = codeState
        if (codeState == "enter" && was != "enter") { code = ""; codeEnter++ }
        if (codeState == "" && (was == "bad" || was == "checking") && data?.str("codeValue").isNullOrEmpty()) code = ""
    }

    Box(Modifier.fillMaxSize().background(Color.Black).absorb()) {
        AuthGlow()
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(56.dp))
            Box(
                Modifier.size(88.dp).graphicsLayer { shadowElevation = 30f; shape = RoundedCornerShape(22.dp); clip = true }
                    .background(Brush.linearGradient(listOf(p.accent, Color(0xFFFF6A5C)))),
                contentAlignment = Alignment.Center,
            ) { Ico(G.play, Color.White, 40.dp) }
            Spacer(Modifier.height(22.dp))
            AnimatedContent(mode, transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(120)) }, label = "authT") { m ->
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    val title = when (m) {
                        "register" -> "Создать аккаунт"
                        "forgot" -> "Сброс пароля"
                        "code" -> "Код из письма"
                        "newpass" -> "Новый пароль"
                        else -> "Вход в авеон"
                    }
                    Txt(title, A.title1.copy(textAlign = TextAlign.Center), p.text)
                    Spacer(Modifier.height(8.dp))
                    Txt(data?.str("sub") ?: "", A.subhead.copy(textAlign = TextAlign.Center), p.text2, Modifier.widthIn(max = 340.dp))
                }
            }
            Spacer(Modifier.height(28.dp))

            Column(
                Modifier.widthIn(max = 420.dp).fillMaxWidth().graphicsLayer { translationX = slide.value.dp.toPx(); alpha = fade.value },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                // поля — одной плашкой с тонкими разделителями
                if (showLogin || showPass) {
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(p.surface)) {
                        if (showLogin) AuthRow(
                            if (forgot) "Аккаунт" else "Логин", login, { login = it }, if (forgot) "логин или почта" else "логин",
                            if (forgot) KeyboardType.Email else KeyboardType.Ascii, divider = showPass, last = !showPass,
                            modifier = Modifier.focusRequester(fLogin), onNext = { if (showPass) fPass.requestFocus() else submit() },
                        )
                        if (showPass) AuthRow(
                            "Пароль", pass, { pass = it }, if (reg || newpass) "не короче 8 символов" else "пароль", KeyboardType.Password,
                            password = !show, divider = showPass2, modifier = Modifier.focusRequester(fPass),
                            trailing = {
                                Ico(if (show) G.eyeSlash else G.eye, if (show) p.accent else p.text2, 22.dp, Modifier.press { show = !show }.padding(8.dp))
                            },
                            last = !showPass2, onNext = { if (showPass2) fPass2.requestFocus() else submit() },
                        )
                        AnimatedVisibility(showPass2, enter = expandVertically(spring(dampingRatio = 0.85f, stiffness = 400f)) + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                            AuthRow("Ещё раз", pass2, { pass2 = it }, "повтори пароль", KeyboardType.Password, password = !show, modifier = Modifier.focusRequester(fPass2), last = true, onNext = { submit() })
                        }
                    }
                }
                if (codeStep) {
                    CodeCells(code, codeState, codeEnter, Modifier.focusRequester(fCode)) { v ->
                        if (v != code) { code = v; Engine.send("authCode", v) }
                    }
                    AnimatedVisibility(codeState == "checking", enter = fadeIn(), exit = fadeOut()) {
                        Row(Modifier.padding(top = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Spinner(size = 14.dp)
                            Spacer(Modifier.width(8.dp))
                            Txt("Проверяю код…", A.footnote, p.text2)
                        }
                    }
                }
                if (showForgot) Row(Modifier.fillMaxWidth().padding(top = 6.dp), horizontalArrangement = Arrangement.End) {
                    Txt("Забыли пароль?", A.footnoteM, p.accent, Modifier.press { focus.clearFocus(); Engine.send("authForgot") }.padding(6.dp))
                }
                AnimatedVisibility(error.isNotEmpty(), enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                    Txt(error, A.footnote.copy(textAlign = TextAlign.Center), p.danger, Modifier.fillMaxWidth().padding(top = 12.dp))
                }
                if (showGo) {
                    Spacer(Modifier.height(22.dp))
                    Box(
                        Modifier.fillMaxWidth().height(52.dp).graphicsLayer { translationX = shake.value }
                            .graphicsLayer { alpha = if (busy) 0.7f else 1f }
                            .clip(RoundedCornerShape(14.dp)).background(p.accent).press(enabled = !busy, scale = 0.97f) { submit() },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (busy) Row(verticalAlignment = Alignment.CenterVertically) {
                            Spinner(color = Color.White, size = 18.dp)
                            Spacer(Modifier.width(10.dp))
                            Txt(data?.str("go") ?: "", A.headline, Color.White)
                        } else Txt(data?.str("go")?.ifEmpty { null } ?: if (reg) "Создать аккаунт" else "Войти", A.headline, Color.White)
                    }
                }
            }
            Spacer(Modifier.height(18.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Txt((data?.str("ask") ?: "") + " ", A.subhead, p.text2)
                Txt(
                    data?.str("other") ?: "", A.subheadM, if (busy) p.text3 else p.accent,
                    Modifier.press(enabled = !busy) { pass2 = ""; Engine.send("authSwitch") }.padding(vertical = 6.dp),
                )
            }
            Spacer(Modifier.height(40.dp))
        }
    }
    LaunchedEffect(inited) {
        if (!inited) return@LaunchedEffect
        // как в app.js: логин известен — сразу пароль
        try { if (login.isEmpty() || !showPass) fLogin.requestFocus() else fPass.requestFocus() } catch (_: Exception) {}
    }
}

/**
 * Шесть ячеек кода из письма. Поле ввода одно и невидимое — ячейки рисует decorationBox (вставка кода работает).
 * Цифры впрыгивают; пока сервер проверяет — рамки дышат; верный код вспыхивает зелёным слева направо,
 * неверный краснеет и трясётся, потом app.js стирает его.
 */
@Composable
private fun CodeCells(value: String, state: String, enterKey: Int, modifier: Modifier, onChange: (String) -> Unit) {
    val locked = state == "checking" || state == "ok" || state == "bad"
    var focused by remember { mutableStateOf(false) }
    val shake = remember { Animatable(0f) }
    LaunchedEffect(state) {
        if (state == "bad") for (x in listOf(-9f, 8f, -5f, 3f, 0f)) shake.animateTo(x, tween(80))
    }
    BasicTextField(
        value, { v -> if (!locked) onChange(v.filter(Char::isDigit).take(6)) },
        modifier.widthIn(max = 380.dp).fillMaxWidth().onFocusChanged { focused = it.isFocused },
        readOnly = locked,
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done, autoCorrectEnabled = false),
        decorationBox = { _ ->
            Row(
                Modifier.fillMaxWidth().graphicsLayer { translationX = shake.value.dp.toPx() },
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                for (i in 0 until 6) {
                    CodeCell(value.getOrNull(i), i, state, enterKey, focused && !locked && i == value.length, Modifier.weight(1f))
                }
            }
        },
    )
}

@Composable
private fun CodeCell(ch: Char?, i: Int, state: String, enterKey: Int, next: Boolean, modifier: Modifier) {
    val p = LocalPal.current
    // появление: ячейки поднимаются по очереди
    val appear = remember { Animatable(1f) }
    LaunchedEffect(enterKey) {
        if (enterKey == 0) return@LaunchedEffect
        appear.snapTo(0f)
        delay(i * 45L)
        appear.animateTo(1f, spring(dampingRatio = 0.6f, stiffness = 420f))
    }
    // цифра впрыгивает с перелётом
    val pop = remember { Animatable(1f) }
    LaunchedEffect(ch) {
        if (ch == null) return@LaunchedEffect
        pop.snapTo(0.5f)
        pop.animateTo(1f, spring(dampingRatio = 0.42f, stiffness = 650f))
    }
    // верный код — вспышка волной слева направо
    val flash = remember { Animatable(0f) }
    LaunchedEffect(state) {
        if (state != "ok") { flash.snapTo(0f); return@LaunchedEffect }
        delay(i * 50L)
        launch { pop.animateTo(1.1f, tween(120)); pop.animateTo(1f, spring(dampingRatio = 0.5f, stiffness = 500f)) }
        flash.animateTo(1f, tween(140))
        flash.animateTo(0.45f, tween(320))
    }
    val breath = if (state == "checking") {
        val tr = rememberInfiniteTransition(label = "otp")
        tr.animateFloat(0.3f, 1f, infiniteRepeatable(tween(520), RepeatMode.Reverse, StartOffset(i * 70)), label = "breath").value
    } else 1f
    val border = when {
        state == "ok" -> OkGreen
        state == "bad" -> p.danger
        state == "checking" -> p.accent.copy(alpha = breath)
        next -> p.accent
        else -> p.line
    }
    val tint = if (state == "bad") p.danger.copy(alpha = 0.18f) else OkGreen.copy(alpha = flash.value * 0.35f)
    val shape = RoundedCornerShape(12.dp)
    Box(
        modifier.aspectRatio(0.8f)
            .graphicsLayer {
                val s = (0.6f + 0.4f * appear.value) * pop.value
                scaleX = s; scaleY = s
                alpha = appear.value.coerceIn(0f, 1f)
                translationY = (1f - appear.value) * 14.dp.toPx()
            }
            .clip(shape).background(p.surface).background(tint)
            .border(if (next || state == "ok" || state == "bad" || state == "checking") 2.dp else 1.dp, border, shape),
        contentAlignment = Alignment.Center,
    ) {
        Txt(ch?.toString() ?: "", A.title2, when (state) { "ok" -> OkGreen; "bad" -> p.danger; else -> p.text })
    }
}

@Composable
private fun AuthRow(
    label: String, value: String, onChange: (String) -> Unit, placeholder: String, type: KeyboardType,
    password: Boolean = false, divider: Boolean = false, last: Boolean = false, modifier: Modifier = Modifier,
    trailing: (@Composable () -> Unit)? = null, onNext: () -> Unit,
) {
    val p = LocalPal.current
    Row(Modifier.fillMaxWidth().padding(start = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.weight(1f).hairline(divider).padding(end = if (trailing != null) 6.dp else 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Txt(label, A.body, p.text, Modifier.width(96.dp), maxLines = 1)
            BasicTextField(
                value, onChange, modifier.weight(1f).padding(vertical = 15.dp),
                textStyle = A.body.copy(color = p.text),
                cursorBrush = SolidColor(p.accent),
                singleLine = true,
                visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
                keyboardOptions = KeyboardOptions(keyboardType = type, imeAction = if (last) ImeAction.Go else ImeAction.Next, autoCorrectEnabled = false),
                keyboardActions = KeyboardActions(onNext = { onNext() }, onGo = { onNext() }, onDone = { onNext() }),
                decorationBox = { inner ->
                    Box {
                        if (value.isEmpty()) Txt(placeholder, A.body, p.text3, maxLines = 1)
                        inner()
                    }
                },
            )
            trailing?.invoke()
        }
    }
}

/** Мягкое свечение за значком: два пятна цвета акцента медленно плывут. */
@Composable
private fun AuthGlow() {
    val p = LocalPal.current
    val tr = rememberInfiniteTransition(label = "glow")
    val ph by tr.animateFloat(0f, TAU, infiniteRepeatable(tween(18000, easing = LinearEasing)), label = "ph")
    Canvas(Modifier.fillMaxSize()) {
        val w = size.width; val h = size.height
        fun blob(c: Color, x: Float, y: Float, r: Float) = drawCircle(Brush.radialGradient(listOf(c, Color.Transparent), Offset(x, y), r), r, Offset(x, y))
        blob(p.accent.copy(alpha = 0.32f), w * (0.3f + 0.15f * sin(ph)), h * (0.12f + 0.05f * cos(ph)), w * 0.8f)
        blob(Color(0xFFB04BFF).copy(alpha = 0.18f), w * (0.75f + 0.12f * cos(ph * 2)), h * (0.22f + 0.06f * sin(ph * 2)), w * 0.7f)
    }
}
