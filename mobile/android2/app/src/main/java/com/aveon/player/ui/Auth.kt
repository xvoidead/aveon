package com.aveon.player.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
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
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
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
import org.json.JSONObject
import kotlin.math.cos
import kotlin.math.sin

// Вход и регистрация в стиле Apple: значок, крупный заголовок, поля одной сгруппированной плашкой,
// большая кнопка. Логика — та же форма движка (app.js), сюда приходят её тексты и ошибки (native.js → authData).

@Composable
fun AuthScreen(panel: Panel) {
    val p = LocalPal.current
    var d by remember { mutableStateOf<JSONObject?>(null) }
    LaunchedEffect(panel) { d = Engine.obj("authData") }
    val data = d
    var server by remember { mutableStateOf("") }
    var login by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var pass2 by remember { mutableStateOf("") }
    var show by remember { mutableStateOf(false) }
    var inited by remember { mutableStateOf(false) }
    LaunchedEffect(data) {
        if (data != null && !inited) { server = data.str("server"); login = data.str("login"); inited = true }
    }
    val reg = data?.optBoolean("register") == true
    val busy = data?.optBoolean("busy") == true
    val error = data?.str("error") ?: ""
    val focus = LocalFocusManager.current
    val fLogin = remember { FocusRequester() }
    val fPass = remember { FocusRequester() }
    val fPass2 = remember { FocusRequester() }
    fun submit() {
        if (busy) return
        focus.clearFocus()
        Engine.send("authSubmit", server, login, pass, pass2)
    }
    // ошибка — кнопка вздрагивает, как поле пароля в iOS
    val shake = remember { Animatable(0f) }
    LaunchedEffect(error) {
        if (error.isNotEmpty()) for (x in listOf(14f, -12f, 9f, -6f, 3f, 0f)) shake.animateTo(x, tween(55))
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
            AnimatedContent(reg, transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(120)) }, label = "authT") { r ->
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Txt(if (r) "Создать аккаунт" else "Вход в авеон", A.title1.copy(textAlign = TextAlign.Center), p.text)
                    Spacer(Modifier.height(8.dp))
                    Txt(data?.str("sub") ?: "", A.subhead.copy(textAlign = TextAlign.Center), p.text2, Modifier.widthIn(max = 340.dp))
                }
            }
            Spacer(Modifier.height(28.dp))

            if (data?.optBoolean("serverLine") == true) {
                Row(Modifier.widthIn(max = 420.dp).fillMaxWidth().padding(bottom = 10.dp, start = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Txt("Сервер ", A.footnote, p.text2)
                    Txt(data.str("serverHost"), A.footnoteM, p.text, Modifier.weight(1f), maxLines = 1)
                    Txt("Изменить", A.footnoteM, p.accent, Modifier.press { Engine.send("authServerEdit") }.padding(4.dp))
                }
            }
            // поля — одной плашкой с тонкими разделителями
            Column(Modifier.widthIn(max = 420.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(p.surface)) {
                if (data?.optBoolean("serverField") == true) {
                    AuthRow("Сервер", server, { server = it }, "1.2.3.4:8787", KeyboardType.Uri, divider = true, onNext = { fLogin.requestFocus() })
                }
                AuthRow("Логин", login, { login = it }, "логин", KeyboardType.Ascii, divider = true, modifier = Modifier.focusRequester(fLogin), onNext = { fPass.requestFocus() })
                AuthRow(
                    "Пароль", pass, { pass = it }, if (reg) "не короче 8 символов" else "пароль", KeyboardType.Password,
                    password = !show, divider = reg, modifier = Modifier.focusRequester(fPass),
                    trailing = { Txt(if (show) "Скрыть" else "Показать", A.footnoteM, p.accent, Modifier.press { show = !show }.padding(6.dp)) },
                    last = !reg, onNext = { if (reg) fPass2.requestFocus() else submit() },
                )
                AnimatedVisibility(reg, enter = expandVertically(spring(dampingRatio = 0.85f, stiffness = 400f)) + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                    AuthRow("Ещё раз", pass2, { pass2 = it }, "повтори пароль", KeyboardType.Password, password = !show, modifier = Modifier.focusRequester(fPass2), last = true, onNext = { submit() })
                }
            }
            AnimatedVisibility(error.isNotEmpty(), enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                Txt(error, A.footnote.copy(textAlign = TextAlign.Center), p.danger, Modifier.widthIn(max = 420.dp).fillMaxWidth().padding(top = 12.dp))
            }
            Spacer(Modifier.height(22.dp))
            Box(
                Modifier.widthIn(max = 420.dp).fillMaxWidth().height(52.dp).graphicsLayer { translationX = shake.value }
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
            Spacer(Modifier.height(18.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Txt((data?.str("ask") ?: "") + " ", A.subhead, p.text2)
                Txt(data?.str("other") ?: "", A.subheadM, p.accent, Modifier.press { pass2 = ""; Engine.send("authSwitch") }.padding(vertical = 6.dp))
            }
            Spacer(Modifier.height(40.dp))
        }
    }
    LaunchedEffect(inited) {
        if (!inited) return@LaunchedEffect
        // как в app.js: логин известен — сразу пароль
        try { if (login.isEmpty()) fLogin.requestFocus() else fPass.requestFocus() } catch (_: Exception) {}
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
