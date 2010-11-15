// Copyright (C) 2010 Nikhil Marathe <nsm.nikhil@gmail.com>

#include <string>
#include <vector>
#include <iostream>

#include <node/v8.h>
#include <node/node.h>

#include <libface/LibFace.h>
#include <libface/Face.h>

using namespace v8;
using namespace node;

namespace face {

Handle<Value> Faces( const Arguments &args ) {
  HandleScope scope;

  std::string filename;
  if (args.Length() > 0 && args[0]->IsString()) {
    Local<String> p = args[0]->ToString();
    String::AsciiValue asc(p);
    filename = *asc;
  }

  libface::LibFace detector;
  std::vector<libface::Face> faces = detector.detectFaces(filename);

  Local<Array> faceArray = Array::New(faces.size());
  for(int i = 0, l = faces.size(); i < l; i++) {
      Local<Object> coords = Object::New();
      coords->Set(String::New("x"), Integer::New(faces[i].getX1()));
      coords->Set(String::New("y"), Integer::New(faces[i].getY1()));
      coords->Set(String::New("width"), Integer::New(faces[i].getWidth()));
      coords->Set(String::New("height"), Integer::New(faces[i].getHeight()));

      faceArray->Set(Integer::New(i), coords);
  }

  return faceArray;
}

void Initialize( Handle<Object> target ) {
  HandleScope scope;

  Local<FunctionTemplate> t = FunctionTemplate::New(Faces);

  target->Set( String::NewSymbol( "faces" ), t->GetFunction() );
}
}

extern "C"
void init( Handle<Object> target ) {
  HandleScope scope;
  face::Initialize( target );
}

