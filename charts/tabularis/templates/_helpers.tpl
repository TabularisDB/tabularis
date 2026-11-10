{{- define "tabularis.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "tabularis.selectorLabels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "tabularis.labels" -}}
{{ include "tabularis.selectorLabels" . }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "tabularis.publicUrl" -}}
{{- required "publicUrl is required, e.g. --set publicUrl=https://tabularis.example.com" .Values.publicUrl | trimSuffix "/" -}}
{{- end -}}

{{/* host[:port] of the public URL: the only Host header the server answers. */}}
{{- define "tabularis.publicHost" -}}
{{- (urlParse (include "tabularis.publicUrl" .)).host -}}
{{- end -}}

{{- define "tabularis.image" -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) -}}
{{- end -}}

{{- define "tabularis.secretName" -}}
{{- .Values.auth.existingSecret | default (include "tabularis.fullname" .) -}}
{{- end -}}

{{/* Non-empty when the chart itself creates a Secret. */}}
{{- define "tabularis.chartSecret" -}}
{{- if or .Values.auth.password .Values.auth.proxySecret .Values.secretStore.key -}}true{{- end -}}
{{- end -}}

{{/* Whether the pod reads `key` from a mounted Secret. */}}
{{- define "tabularis.hasSecretKey" -}}
{{- $values := index . 0 -}}
{{- $key := index . 1 -}}
{{- if $values.auth.existingSecret -}}true
{{- else if and (eq $key "web-password") $values.auth.password -}}true
{{- else if and (eq $key "proxy-secret") $values.auth.proxySecret -}}true
{{- else if and (eq $key "secret-key") $values.secretStore.key -}}true
{{- end -}}
{{- end -}}
